if (typeof DeroNFTApp !== 'undefined') {
    const ORDER_TYPES = {
        SELL: 'sell',
        BUY: 'buy'
    };

    DeroNFTApp.prototype.startArtificerSale = async function(asset, priceDero, durationHours) {
        if (!this.callContractEntry) {
            throw new Error('Wallet connection not available for Artificer sale.');
        }
        
        // Normalize SCID to lowercase to ensure wallet can decode it properly
        // The wallet needs SCIDs in lowercase format to resolve them correctly
        const normalizedScid = asset.scid.toLowerCase().trim();
        
        // Check initial balance before transaction
        let initialBalance = 0;
        try {
            const balanceCheck = await this.deroWallet?.ws?.sendRequest('GetBalance', { scid: normalizedScid });
            initialBalance = balanceCheck?.result?.balance || 0;
            if (initialBalance < 1) {
                this.showError('You do not own this NFA. Balance is less than 1 atomic unit.');
                return;
            }
        } catch (balanceError) {
            // Continue anyway - let the contract reject if balance is insufficient
        }
        
        // Validate NFA SCID exists and ensure wallet has it in state tree
        // This helps the wallet recognize the SCID before using it as a transfer destination
        try {
            const scResult = await this.deroWallet.ws.getSC(normalizedScid);
            if (scResult && scResult.error) {
                // Don't throw - let the contract call proceed
            } else if (scResult && (scResult.result || scResult.status === 'OK')) {
                // Delay to ensure wallet has processed the SCID in its state tree
                // The wallet needs time to index the SCID before it can be used as a transfer destination
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch (error) {
            // Ignore SC validation errors
        }
        
        // For ART-NFA-MS1, the NFA contract acts as its own marketplace
        // The Start function requires:
        // - 1 atomic unit of the NFA asset to be transferred to the NFA contract itself
        // - Price in DERO (atomic units)
        // - Duration in hours
        const priceAtomic = this.deroToAtomic ? this.deroToAtomic(priceDero) : Math.floor(priceDero * 100000);
        
        // Format per DERO docs: transfers array contains scid (asset SCID) and burn amount
        // TRANSFER DESTINATION: When using 'burn' with 'scid', asset automatically goes to contract in main scid param
        // Main scid parameter (normalizedScid) = NFA contract SCID = destination for the asset
        // The 1 atomic unit goes to the NFA contract itself
        // Reference: https://github.com/deroproject/documentation/blob/master/DVMDOCS/examples/assetexchange/example.sh
        // Asset transfers with scid + burn do NOT need destination field - asset goes to contract automatically
        const transfers = [{
            scid: normalizedScid,         // The SCID of the NFA asset being sent
            burn: 1                      // 1 atomic unit (burned to NFA contract in main scid param)
        }];
        
        // Contract expects: Start(listType String, duration Uint64, startPrice Uint64, charityDonateAddr String, charityDonatePerc Uint64)
        // Reference: https://github.com/civilware/artificer-nfa-standard/blob/main/ART-NFA-MS1/README.md#start
        // Note: ART-NFA-MS1 requires SC_ACTION and SC_ID parameters per official documentation
        // SC_ACTION: 0 (standard action)
        // SC_ID: The contract SCID (in hex format, not address format)
        // Note: callContractEntry automatically adds 'entrypoint', so we don't add it here
        const scRpc = [
            { name: 'listType', datatype: 'S', value: 'sale' },  // First parameter: listType (String)
            { name: 'duration', datatype: 'U', value: durationHours },  // Second parameter: duration (Uint64)
            { name: 'startPrice', datatype: 'U', value: priceAtomic },  // Third parameter: startPrice (Uint64)
            { name: 'charityDonateAddr', datatype: 'S', value: '' },  // Fourth parameter: charityDonateAddr (String) - empty string for no charity
            { name: 'charityDonatePerc', datatype: 'U', value: 0 },  // Fifth parameter: charityDonatePerc (Uint64) - 0 for no charity donation
            { name: 'SC_ACTION', datatype: 'U', value: 0 },  // Required by ART-NFA-MS1 standard
            { name: 'SC_ID', datatype: 'H', value: normalizedScid }  // Required by ART-NFA-MS1 standard - SCID in hex format
        ];
        
        let response;
        try {
            response = await this.callContractEntry(normalizedScid, 'Start', scRpc, { transfers: transfers });
        } catch (error) {
            this.logTransactionError?.('NFA Start Sale', error, {
                scid: normalizedScid,
                entrypoint: 'Start',
                assetScid: normalizedScid,
                price: priceAtomic,
                duration: durationHours,
                transfers
            });
            return;
        }

        // Extract txid - handle both response formats
        const txid = response?.result?.txid ?? response?.txid ?? response?.txid;
        const returnValue = response?.result?.value ?? response?.value;
        
        if (!txid) {
            this.showError('Transaction failed: No transaction ID received. Please check wallet connection and try again.');
            // Return null/undefined so submitAssetSellOrder knows it failed
            return null;
        }
        
        if (returnValue !== undefined && returnValue !== null && returnValue !== 0) {
            const errorMessages = {
                1: 'Invalid price (must be > 0)',
                2: 'Invalid duration',
                3: 'Contract not initialized',
                4: 'Insufficient asset balance (must have 1 atomic unit)',
                5: 'Asset already listed'
            };
            const errorMsg = errorMessages[returnValue] || `Contract returned error code: ${returnValue}`;
            const contractError = new Error(`NFA listing rejected by contract: ${errorMsg}`);
            this.logTransactionError?.('NFA Start Sale - Contract Rejection', contractError, {
                scid: normalizedScid,
                entrypoint: 'Start',
                returnValue,
                txid,
                response,
                errorMessage: errorMsg
            });
            return;
        }

        // IMPORTANT: Check balance and transaction return value after transaction to verify it succeeded
        // Wait a moment for the transaction to be processed
        if (txid) {
            // Wait for transaction to be mined
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            
            // Check transaction return value if available
            try {
                const txCheck = await this.deroWallet?.ws?.sendRequest('DERO.GetTransaction', { 
                    txs_hashes: [txid], 
                    decode_as_json: true 
                });
                const txResult = txCheck?.result?.txs?.[0];
                if (txResult?.payload_rpc) {
                    const returnParam = txResult.payload_rpc.find(p => p.name === 'return' || p.datatype === 'return');
                    if (returnParam && returnParam.value !== undefined && returnParam.value !== null && returnParam.value !== 0) {
                        const errorMessages = {
                            1: 'Invalid price (must be > 0)',
                            2: 'Invalid duration',
                            3: 'Contract not initialized',
                            4: 'Insufficient asset balance (must have 1 atomic unit)',
                            5: 'Asset already listed'
                        };
                        const errorMsg = errorMessages[returnParam.value] || `Contract returned error code: ${returnParam.value}`;
                        this.showError(`NFA listing rejected: ${errorMsg}. Transaction: ${txid}`);
                        return;
                    }
                }
            } catch (txError) {
                // Ignore transaction check errors
            }
            
            // Check balance to see if asset was transferred
            try {
                const balanceCheck = await this.deroWallet?.ws?.sendRequest('GetBalance', { scid: normalizedScid });
                const newBalance = balanceCheck?.result?.balance || 0;
                
                // For NFAs, starting a sale transfers 1 atomic unit to the contract
                // So balance should decrease by 1 (from initialBalance to initialBalance - 1)
                if (newBalance >= initialBalance) {
                    this.showError(`Transaction submitted but asset balance did not decrease (was ${initialBalance}, now ${newBalance}). The contract may have rejected the transfer. Check the transaction status or try again.`);
                    return;
                }
            } catch (balanceError) {
                // Ignore balance verification errors
            }
        }

        if (txid) {
            this.showNotification(`NFA listing transaction submitted (txid: ${txid}). Waiting for confirmation...`, 'info', 0); // 0 duration for sticky
            
            let confirmed = false;
            const maxAttempts = 30; // Check for up to 30 seconds
            for (let i = 0; i < maxAttempts; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                try {
                    const scResult = await this.deroWallet.ws.getSC(normalizedScid);
                    const scData = scResult?.result || scResult;
                    const stringKeys = scData?.stringkeys || {};
                    const uint64Keys = scData?.uint64keys || {};

                    const decS = (key) => {
                        const raw = stringKeys[key];
                        if (!raw) return '';
                        return this.decodeHexString ? this.decodeHexString(raw) : raw;
                    };
                    const decU = (key) => {
                        if (uint64Keys[key] !== undefined) {
                            const v = parseInt(uint64Keys[key], 10);
                            return Number.isNaN(v) ? 0 : v;
                        }
                        const raw = stringKeys[key];
                        if (!raw) return 0;
                        const d = this.decodeHexString ? this.decodeHexString(raw) : raw;
                        const p = parseInt(d, 10);
                        return Number.isNaN(p) ? 0 : p;
                    };
                    
                    const active = decU('active');
                    const scBalance = decU('scBalance');
                    const listType = decS('listType');
                    const owner = decS('owner');
                    const currentAddress = this.currentAddress || '';
                    const addressMatches = (addr) => {
                        if (!addr) return false;
                        const normalize = (a) => {
                            if (!a) return '';
                            const lower = a.toLowerCase();
                            if (lower.startsWith('dero1')) return lower;
                            if (lower.startsWith('deto1')) return 'dero' + lower.substring(4);
                            return lower;
                        };
                        return normalize(addr) === normalize(currentAddress) || 
                               addr.toLowerCase() === currentAddress.toLowerCase() ||
                               addr.toLowerCase().substring(0, 20) === currentAddress.toLowerCase().substring(0, 20);
                    };
                    const isOwner = owner && addressMatches(owner);

                    // Confirm listing if active, or escrowed and owner matches, or listing data exists and owner matches
                    if ((active === 1 && scBalance === 1 && (listType === 'sale' || listType === 'auction')) ||
                        (isOwner && scBalance > 0) ||
                        (isOwner && (listType === 'sale' || listType === 'auction'))) {
                        confirmed = true;
                        break;
                    }
                } catch (error) {
                    // Ignore confirmation check errors
                }
            }
            
            if (confirmed) {
                this.showSuccess(`✅ NFA listing confirmed on-chain! (txid: ${txid})`);
            } else {
                this.showSuccess(`NFA listing transaction sent (txid: ${txid}). Listing may take a few moments to appear.`);
            }
            
            // Refresh asset status after a delay to detect the listing
            setTimeout(async () => {
                if (this.loadAssets) {
                    await this.loadAssets(true);
                }
                if (this.loadSellOrders) {
                    await this.loadSellOrders(true); // Force refresh sell orders
                }
            }, 2000); // Wait 2 seconds for block confirmation
        } else {
            this.showSuccess('NFA listing request sent. Please approve in wallet if prompted.');
        }
        
        return response;
    };

    DeroNFTApp.prototype.startArtificerBuyNow = async function(asset, priceDero) {
        if (!this.callContractEntry) {
            throw new Error('Wallet connection not available for Artificer buy.');
        }
        
        const normalizedScid = asset.scid.toLowerCase().trim();
        const priceAtomic = this.deroToAtomic ? this.deroToAtomic(priceDero) : Math.floor(priceDero * 100000);
        
        // ART-NFA-MS1 BuyItNow requires SC_ACTION and SC_ID parameters per official documentation
        // Reference: https://github.com/civilware/artificer-nfa-standard/blob/main/ART-NFA-MS1/README.md#buyitnow
        // Note: The docs show BuyItNow with destination in transfers, but we send DERO amount instead
        // Note: callContractEntry automatically adds 'entrypoint', so we don't add it here
        const scRpc = [
            { name: 'SC_ACTION', datatype: 'U', value: 0 },  // Required by ART-NFA-MS1 standard
            { name: 'SC_ID', datatype: 'H', value: normalizedScid }  // Required by ART-NFA-MS1 standard - SCID in hex format
        ];
        
        // BuyItNow requires sending DERO to the contract (price amount)
        // The transfers format for BuyItNow uses destination + burn according to docs
        // But we're using the amount parameter which should send DERO to the contract
        const response = await this.callContractEntry(normalizedScid, 'BuyItNow', scRpc, { amount: priceAtomic });
        
        // Check for contract return value (error codes)
        // NFA BuyItNow typically returns: 0 (success) or error code (> 0)
        const returnValue = response?.result?.value;
        if (returnValue !== undefined && returnValue !== null && returnValue !== 0) {
            const errorMessages = {
                1: 'Listing not found or not active',
                2: 'Price mismatch - offer price does not match listing price',
                3: 'Insufficient DERO sent',
                4: 'Contract not initialized',
                5: 'Listing expired'
            };
            const errorMsg = errorMessages[returnValue] || `Contract returned error code: ${returnValue}`;
            throw new Error(`NFA buy rejected by contract: ${errorMsg}. Your DERO should have been returned to your wallet.`);
        }
        
        return response;
    };

    /* ------------------------------------------------------------------
     * Order management functions
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.closeOrdersForAsset = function(scid, tokenId) {
        if (!scid) {
            this.showError?.('Invalid asset SCID');
            return;
        }
        
        // Check if this is an NFA (ART-NFA-MS1)
        // NFAs use their own Start/CancelListing functions
        const asset = this.savedAssets?.find(a => a.scid === scid);
        const isNFA = asset && (asset.type === 'NFA' || asset.contractType === 'ART-NFA-MS1');
        
        if (isNFA) {
            // Use NFA-specific cancellation
            this.cancelNFAListing(scid);
        } else {
            // Use G45 marketplace cancellation
            this._closeOrdersForAssetOnChain(scid, tokenId);
        }
    };

    DeroNFTApp.prototype._closeOrdersForAssetOnChain = async function(scid, tokenId) {
        if (!this.currentAddress || !this.deroWallet || !this.deroWallet.ws) {
            this.showError?.('Please connect your wallet first.');
            return;
        }
        
        try {
            const marketScid = this.ensureG45MarketplaceScid ? this.ensureG45MarketplaceScid(false) : '';
            if (!marketScid || marketScid.length !== 64) {
                this.showError?.('G45 marketplace SCID is not configured.');
                return;
            }
            
            // Query marketplace for active orders
            const scResult = await this.deroWallet.ws.getSC(marketScid);
            const scData = scResult?.result || scResult;
            const stringKeys = scData?.stringkeys || {};
            const uint64Keys = scData?.uint64keys || {};
            
            const decS = (key) => {
                const raw = stringKeys[key];
                if (!raw) return '';
                return this.decodeHexString ? this.decodeHexString(raw) : raw;
            };
            const decU = (key) => {
                if (uint64Keys[key] !== undefined) {
                    const v = parseInt(uint64Keys[key], 10);
                    return Number.isNaN(v) ? 0 : v;
                }
                const raw = stringKeys[key];
                if (!raw) return 0;
                const d = this.decodeHexString ? this.decodeHexString(raw) : raw;
                const p = parseInt(d, 10);
                return Number.isNaN(p) ? 0 : p;
            };
            
            const orderCounter = decU('order_counter');
            const sellCounter = decU('sell_counter');
            const maxOrderId = Math.max(orderCounter || 0, sellCounter || 0);
            const normalizedScid = scid.toLowerCase().trim();
            const currentAddress = this.currentAddress || '';
            
            // Find orders for this asset
            const ordersToClose = [];
            for (let id = 1; id <= maxOrderId; id++) {
                const seller = decS(`sell_order_seller_${id}`);
                const assetScid = decS(`sell_order_asset_${id}`);
                const status = decS(`sell_order_status_${id}`);
                
                if (seller && seller.toLowerCase() === currentAddress.toLowerCase() &&
                    assetScid && assetScid.toLowerCase() === normalizedScid &&
                    status === 'active') {
                    ordersToClose.push(id);
                }
            }
            
            if (ordersToClose.length === 0) {
                this.showNotification?.('No active sell orders found for this asset.', 'info');
                return;
            }
            
            // Close each order
            for (const orderId of ordersToClose) {
                try {
                    const scRpc = [{ name: 'order_id', datatype: 'U', value: orderId }];
                    await this.callContractEntry(marketScid, 'CancelSellOrder', scRpc, {});
                    this.showSuccess?.(`Order ${orderId} cancelled successfully.`);
                } catch (error) {
                    this.showError?.(`Failed to cancel order ${orderId}: ${error.message}`);
                }
            }
            
            // Refresh orders list
            setTimeout(() => {
                if (this.loadSellOrders) {
                    this.loadSellOrders(true);
                }
            }, 2000);
        } catch (error) {
            this.showError?.(`Failed to close orders: ${error.message}`);
        }
    };

    DeroNFTApp.prototype.cancelNFAListing = async function(scid) {
        if (!this.currentAddress || !this.deroWallet || !this.deroWallet.ws) {
            this.showError?.('Please connect your wallet first.');
            return;
        }
        
        const normalizedScid = scid.toLowerCase().trim();
        
        try {
            // Query NFA contract state
            const scResult = await this.deroWallet.ws.getSC(normalizedScid);
            const scData = scResult?.result || scResult;
            const stringKeys = scData?.stringkeys || {};
            const uint64Keys = scData?.uint64keys || {};

            const decS = (key) => {
                const raw = stringKeys[key];
                if (!raw) return '';
                return this.decodeHexString ? this.decodeHexString(raw) : raw;
            };
            const decU = (key) => {
                if (uint64Keys[key] !== undefined) {
                    const v = parseInt(uint64Keys[key], 10);
                    return Number.isNaN(v) ? 0 : v;
                }
                const raw = stringKeys[key];
                if (!raw) return 0;
                const d = this.decodeHexString ? this.decodeHexString(raw) : raw;
                const p = parseInt(d, 10);
                return Number.isNaN(p) ? 0 : p;
            };
            
            const active = decU('active');
            const scBalance = decU('scBalance');
            const listType = decS('listType');
            const ownerRaw = stringKeys['owner']; // Keep raw owner for debugging
            const owner = decS('owner'); // Decoded owner
            const currentAddress = this.currentAddress || '';
            
            const normalizeAddress = (addr) => {
                if (!addr) return '';
                const lower = addr.toLowerCase();
                if (lower.startsWith('dero1')) return lower;
                if (lower.startsWith('deto1')) return 'dero' + lower.substring(4);
                return lower;
            };
            const addressMatches = (addr1, addr2) => {
                if (!addr1 || !addr2) return false;
                const n1 = normalizeAddress(addr1);
                const n2 = normalizeAddress(addr2);
                return n1 === n2 || 
                       addr1.toLowerCase() === addr2.toLowerCase() ||
                       addr1.toLowerCase().substring(0, 20) === addr2.toLowerCase().substring(0, 20);
            };
            
            const isOwner = owner && addressMatches(owner, currentAddress);
            
            
            const hasListing = (active === 1 && scBalance === 1 && (listType === 'sale' || listType === 'auction')) ||
                              (scBalance > 0) || // Asset is escrowed
                              (listType === 'sale' || listType === 'auction'); // Listing exists
            
            if (!hasListing) {
                this.showError(`No listing found. Status: active=${active}, scBalance=${scBalance}, listType=${listType || 'none'}, owner=${owner ? owner.substring(0, 20) + '...' : 'none'}, isOwner=${isOwner}. Use "Query NFA Status" in Wallet Calls tab to debug.`);
                return;
            }
            
            if (!isOwner) {
                // Still try to cancel if asset is escrowed (might be pending confirmation)
                if (scBalance > 0) {
                    this.showNotification('You are not detected as the owner, but the NFA is escrowed. Attempting to cancel. The contract will reject this transaction if you are not the true owner.', 'warning', 0);
                } else {
                    this.showError('You are not the owner of this NFA. Only the owner can cancel listings. The contract will reject this transaction if you are not the owner.');
                    return;
                }
            }
            
            // Try CancelListing first (observes cancelBuffer), fall back to CloseListing
            // The contract will check SIGNER() == owner before allowing cancel
            this.showNotification('Attempting to cancel NFA listing...', 'info');
            try {
                const response = await this.callContractEntry(normalizedScid, 'CancelListing', []);
                const txid = response?.result?.txid;
                this.showSuccess(`NFA listing cancel request sent${txid ? ` (txid: ${txid})` : ''}. Please approve in wallet if prompted.`);
                // Refresh asset status after a delay
                setTimeout(async () => {
                    if (this.loadAssets) {
                        await this.loadAssets(true);
                    }
                }, 2000);
            } catch (errCancel) {
                try {
                    await this.callContractEntry(normalizedScid, 'CloseListing', []);
                    this.showSuccess('NFA listing closed successfully. The escrowed asset will be returned to you.');
                    // Refresh asset status after a delay
                    setTimeout(async () => {
                        if (this.loadAssets) {
                            await this.loadAssets(true);
                        }
                    }, 2000);
                } catch (errClose) {
                    this.showError(`Failed to cancel/close NFA listing: ${errClose.message || errClose}`);
                }
            }
        } catch (error) {
            this.showError(`Failed to cancel NFA listing: ${error.message}`);
        }
    };
}
