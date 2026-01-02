if (typeof DeroNFTApp !== 'undefined') {

    DeroNFTApp.prototype.cancelOrder = function(orderId, type) {
        this.showNotification?.('Order cancellation not yet implemented.', 'info');
    };

    DeroNFTApp.prototype.editOrder = function(orderId, type) {
        this.showNotification?.('Order editing not yet implemented.', 'info');
    };

    DeroNFTApp.prototype.viewOrderDetails = function(orderId) {
        this.showNotification?.('Order details view not yet implemented.', 'info');
    };

    DeroNFTApp.prototype.handleSendForm = async function(event) {
        try {
            if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
            }

            if (!this.currentAddress) {
                this.showError('Please connect your wallet first.');
                return;
            }
            if (!this.deroWallet || !this.deroWallet.ws) {
                this.showError('Wallet connection unavailable.');
                return;
            }

            const toInput = document.getElementById('toAddress');
            const assetInput = document.getElementById('assetId');
            if (!toInput || !assetInput) {
                this.showError('Form fields not found.');
                return;
            }

            const toAddress = (toInput.value || '').trim();
            const assetIdRaw = (assetInput.value || '').trim();

            if (!toAddress || !this.isValidAddress || !this.isValidAddress(toAddress)) {
                this.showError('Enter a valid recipient DERO address.');
                return;
            }
            if (!assetIdRaw) {
                this.showError('Enter the NFT/NFA identifier to send.');
                return;
            }

            const resolved = this.resolveAssetIdentifier ? this.resolveAssetIdentifier(assetIdRaw) : null;
            if (!resolved || !resolved.scid) {
                this.showError('Unable to determine SCID for this asset.');
                return;
            }

            this.showNotification('Requesting wallet approval to send asset...', 'info');
            
            // Try to find asset info from cache
            let assetInfo = this.findAssetByScid ? this.findAssetByScid(resolved.scid) : null;
            
            // If not in cache, try to query the asset to determine type
            if (!assetInfo) {
                try {
                    if (this.queryAssetBySCID) {
                        assetInfo = await this.queryAssetBySCID(resolved.scid);
                    }
                } catch (queryError) {
                    console.warn('⚠️ [Send Asset] Could not query asset type:', queryError);
                }
            }
            
            // Detect asset type - check if it's an NFA
            // Try multiple methods to detect NFA since detection can be unreliable
            let isNFA = false;
            let isNFT = false;
            
            if (assetInfo) {
                isNFA = this.isArtificerAsset ? this.isArtificerAsset(assetInfo) : false;
                isNFT = this.isG45Asset ? this.isG45Asset(assetInfo) : false;
            }
            
            // If assetInfo check failed, try querying the asset directly
            if (!isNFA && !isNFT && !assetInfo) {
                try {
                    if (this.queryAssetBySCID) {
                        const queriedAsset = await this.queryAssetBySCID(resolved.scid);
                        if (queriedAsset) {
                            isNFA = this.isArtificerAsset ? this.isArtificerAsset(queriedAsset) : false;
                            isNFT = this.isG45Asset ? this.isG45Asset(queriedAsset) : false;
                            assetInfo = queriedAsset; // Update assetInfo with queried data
                            console.log('📤 [Send Asset] Queried asset type from contract:', { isNFA, isNFT });
                        }
                    }
                } catch (queryError) {
                    console.warn('⚠️ [Send Asset] Could not query asset for type detection:', queryError);
                }
            }
            
            // Also check balance - NFA always has balance of 1 atomic unit
            // This is a fallback detection method
            if (!isNFA && !isNFT && !resolved.tokenId) {
                try {
                    const balanceCheck = await this.deroWallet?.ws?.sendRequest('GetBalance', { scid: resolved.scid });
                    const balance = balanceCheck?.result?.balance || 0;
                    if (balance === 1) {
                        // Balance of 1 is strongly indicative of NFA (NFTs have balance of 100000)
                        console.log('📊 [Send Asset] Balance check suggests NFA (balance = 1)');
                        isNFA = true;
                    } else if (balance === 100000) {
                        console.log('📊 [Send Asset] Balance check suggests NFT (balance = 100000)');
                        isNFT = true;
                    }
                } catch (balanceError) {
                    console.warn('⚠️ [Send Asset] Could not check balance for type detection:', balanceError);
                }
            }
            
            console.log('📤 [Send Asset] Asset detection:', {
                scid: resolved.scid.substring(0, 16) + '...',
                isNFA,
                isNFT,
                hasAssetInfo: !!assetInfo,
                tokenId: resolved.tokenId,
                detectionMethod: assetInfo ? 'assetInfo' : 'balance_check'
            });
            
            let transferSuccess = false;
            try {
                if (isNFA && !resolved.tokenId) {
                    // NFA transfer - just transfer the 1 atomic unit balance (same as NFT but amount = 1)
                    // Note: We do NOT call transferOwnership - that changes the contract owner, which is different
                    // For simple asset transfer, we just send the 1 atomic unit balance
                    console.log('📤 [Send Asset] Using NFA transfer method (sendSingleAsset with amount = 1)');
                    // Pass assetInfo with isNFA flag so getTransferAmountForAsset uses correct amount
                    const nfaAssetInfo = assetInfo || { scid: resolved.scid, type: 'NFA' };
                    await this.sendSingleAsset(resolved.scid, toAddress, nfaAssetInfo);
                    transferSuccess = true;
                } else if (resolved.tokenId) {
                    // Collection token transfer
                    console.log('📤 [Send Asset] Using collection token transfer method');
                    await this.sendCollectionToken(resolved.scid, resolved.tokenId, toAddress);
                    transferSuccess = true;
                } else {
                    // NFT or unknown - use sendSingleAsset with assetInfo for proper amount detection
                    console.log('📤 [Send Asset] Using single asset transfer method (sendSingleAsset)');
                    await this.sendSingleAsset(resolved.scid, toAddress, assetInfo);
                    transferSuccess = true;
                }
            } catch (sendError) {
                const errorMsg = sendError?.message || sendError?.error?.message || 'Unknown error';
                if (errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                    return;
                } else {
                    this.showError(`Failed to send asset: ${errorMsg}`);
                }
                return;
            }
            
            // Only show success and reset form if transfer was actually submitted
            if (transferSuccess) {
                try {
                    this.showSuccess('Transfer submitted. Approve it in Engram to complete.');

                    const form = document.getElementById('sendForm');
                    if (form) {
                        form.reset();
                    }
                    const fromField = document.getElementById('fromAddress');
                    if (fromField) {
                        fromField.value = this.currentAddress;
                    }
                    
                    if (typeof this.loadAssets === 'function') {
                        this.loadAssets(true);
                    }
                } catch (formError) {
                    // Ignore form reset errors
                }
            }
        } catch (error) {
            this.showError(`Send form error: ${error.message || 'Unknown error'}`);
        }
    };

    DeroNFTApp.prototype.resolveAssetIdentifier = function(identifier) {
        const cleaned = (identifier || '').trim();
        if (!cleaned) {
            return null;
        }

        const asset = this.findAssetById ? this.findAssetById(cleaned) : null;
        if (asset) {
            return {
                scid: asset.scid || asset.collection_scid || '',
                tokenId: asset.tokenId || ''
            };
        }

        const parsed = this.splitAssetIdentifier ? this.splitAssetIdentifier(cleaned) : { scid: '', tokenId: '' };
        if (parsed.scid) {
            return parsed;
        }

        if (cleaned.length === 64 && /^[0-9a-fA-F]+$/.test(cleaned)) {
            return { scid: cleaned, tokenId: '' };
        }

        return null;
    };

    DeroNFTApp.prototype.getTransferAmountForAsset = async function(scid, assetInfo = null) {
        if (!scid || scid.length !== 64 || !/^[0-9a-fA-F]+$/.test(scid)) {
            throw new Error('Invalid SCID format.');
        }

        // Detect asset type if not provided
        let isNFT = false;
        let isNFA = false;
        
        if (assetInfo) {
            isNFT = this.isG45Asset ? this.isG45Asset(assetInfo) : false;
            isNFA = this.isArtificerAsset ? this.isArtificerAsset(assetInfo) : false;
        } else {
            // Try to detect from cached asset or query
            try {
                const cachedAsset = this.findAssetByScid ? this.findAssetByScid(scid) : null;
                if (cachedAsset) {
                    isNFT = this.isG45Asset ? this.isG45Asset(cachedAsset) : false;
                    isNFA = this.isArtificerAsset ? this.isArtificerAsset(cachedAsset) : false;
                } else {
                    // Query asset type from contract - try to detect NFA first (more specific)
                    try {
                        const assetData = await this.queryAssetBySCID ? await this.queryAssetBySCID(scid) : null;
                        if (assetData) {
                            isNFT = this.isG45Asset ? this.isG45Asset(assetData) : false;
                            isNFA = this.isArtificerAsset ? this.isArtificerAsset(assetData) : false;
                        }
                    } catch (queryError) {
                        console.warn('⚠️ [getTransferAmountForAsset] Could not query asset:', queryError);
                    }
                }
            } catch (e) {
                console.warn('⚠️ [getTransferAmountForAsset] Error detecting asset type:', e);
                // Default to NFT if detection fails (safer - user can manually use transferNFAOwnership)
            }
        }

        // ORED ALWAYS uses fixed amounts - never uses GetBalance for NFT/NFA transfers
        // NFT: Always 100,000 atomic units (regardless of what was displayed)
        // NFA: Always 1 atomic unit
        const NFT_AMOUNT = 100000; // Fixed: 100,000 atomic units = 1 NFT (ALWAYS)
        const NFA_AMOUNT = 1; // Fixed: 1 atomic unit = 1 NFA (ALWAYS)

        let amount;
        if (isNFA) {
            amount = NFA_AMOUNT;
            console.log('📊 [getTransferAmountForAsset] Detected NFA - using amount:', amount);
        } else if (isNFT) {
            amount = NFT_AMOUNT;
            console.log('📊 [getTransferAmountForAsset] Detected NFT - using amount:', amount);
        } else {
            // Unknown type - default to NFT amount but warn
            amount = NFT_AMOUNT;
            console.warn('⚠️ [getTransferAmountForAsset] Unknown asset type - defaulting to NFT amount:', amount, 'SCID:', scid.substring(0, 16) + '...');
        }

        return amount;
    };

    DeroNFTApp.prototype.sendSingleAsset = async function(scid, toAddress, assetInfo = null) {
        try {
            if (!this.deroWallet || !this.deroWallet.ws) {
                throw new Error('Wallet not connected.');
            }
            
            // Validate inputs
            if (!scid || scid.length !== 64 || !/^[0-9a-fA-F]+$/.test(scid)) {
                throw new Error('Invalid SCID format.');
            }
            if (!toAddress || !this.isValidAddress || !this.isValidAddress(toAddress)) {
                throw new Error('Invalid recipient address.');
            }

            // Get transfer amount - pass assetInfo if available for better detection
            const amount = await this.getTransferAmountForAsset(scid, assetInfo);
            
            console.log('📤 [Send Single Asset] Transfer details:', {
                scid: scid.substring(0, 16) + '...',
                toAddress: toAddress.substring(0, 20) + '...',
                amount,
                hasAssetInfo: !!assetInfo,
                isNFA: assetInfo ? (this.isArtificerAsset ? this.isArtificerAsset(assetInfo) : false) : 'unknown',
                isNFT: assetInfo ? (this.isG45Asset ? this.isG45Asset(assetInfo) : false) : 'unknown'
            });
            const params = {
                ringsize: 2,
                transfers: [
                    {
                        destination: toAddress,
                        amount: amount,
                        scid: scid  // The SCID is the asset itself
                    }
                ]
            };
            
            console.log('📤 [Send Single Asset] Transfer params:', {
                ringsize: params.ringsize,
                transfer: {
                    destination: toAddress.substring(0, 20) + '...',
                    amount,
                    scid: scid.substring(0, 16) + '...'
                }
            });
            
            let response;
            try {
                response = await this.deroWallet.ws.sendRequest('transfer', params);
            } catch (e) {
                this.logTransactionError?.('Direct Asset Transfer', e, {
                    scid,
                    toAddress,
                    amount,
                    params,
                    assetInfo
                });
                throw e;
            }
            
            // Check for error in response
            if (response?.error) {
                const errorCode = response.error.code;
                const errorMsg = response.error.message || 'Wallet transfer failed';
                const error = new Error(errorMsg);
                error.code = errorCode;
                
                this.logTransactionError?.('Direct Asset Transfer - Response Error', error, {
                    scid,
                    toAddress,
                    amount,
                    params,
                    response,
                    errorCode,
                    errorMessage: errorMsg,
                    assetInfo
                });
                
                // Handle permission denied
                if (errorCode === -32043 || errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                    throw new Error('Permission not granted');
                } else {
                    throw error;
                }
            }
            
            const txid = response?.result?.txid;
            console.log('✅ [Send Single Asset] Transfer successful:', {
                txid,
                scid: scid.substring(0, 16) + '...',
                amount,
                toAddress: toAddress.substring(0, 20) + '...'
            });
            
            this.showSuccess?.(`Transfer submitted${txid ? ` (txid: ${txid.substring(0, 16)}...)` : ''}.`);
            
            // Optimistically update ownership status immediately
            // Mark asset as "not owned" since we just transferred it
            try {
                const asset = this.findAssetByScid ? this.findAssetByScid(scid) : null;
                if (asset) {
                    asset.ownershipStatus = 'not-owned';
                    asset.owned = false;
                    // Update in saved assets cache
                    if (Array.isArray(this.savedAssets)) {
                        const savedAsset = this.savedAssets.find(a => a.scid === scid);
                        if (savedAsset) {
                            savedAsset.ownershipStatus = 'not-owned';
                            savedAsset.owned = false;
                            this.saveAssets();
                        }
                    }
                    // Update UI immediately
                    if (this.currentTab === 'view' && this.assetsCache?.value) {
                        this.renderAssetsWithOrders(this.assetsCache.value);
                    }
                }
            } catch (e) {
                console.warn('Could not update ownership status optimistically:', e);
            }
            
            if (txid && this.pollTxConfirmation) {
                this.pollTxConfirmation(txid, { intervalMs: 4000, timeoutMs: 90000 },
                    async () => {
                        await this.ensureTransferAssetCache?.(true);
                        this.showNotification(`Transfer confirmed (tXID: ${txid})`, { type: 'success', durationMs: 30000, closable: true });
                        
                        // Update ownership status after confirmation
                        try {
                            const asset = this.findAssetByScid ? this.findAssetByScid(scid) : null;
                            if (asset) {
                                asset.ownershipStatus = 'not-owned';
                                asset.owned = false;
                                // Update in saved assets cache
                                if (Array.isArray(this.savedAssets)) {
                                    const savedAsset = this.savedAssets.find(a => a.scid === scid);
                                    if (savedAsset) {
                                        savedAsset.ownershipStatus = 'not-owned';
                                        savedAsset.owned = false;
                                        this.saveAssets();
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('Could not update ownership status after confirmation:', e);
                        }
                        
                        if (this.currentTab === 'view' && this.assetsCache?.value) {
                            this.renderAssetsWithOrders(this.assetsCache.value);
                        }
                        if (this.currentTab === 'sell') this.loadSellOrders?.();
                        if (this.currentTab === 'buy') this.loadBuyOrders?.();
                    },
                    () => {
                        this.showNotification(`Transaction pending confirmation (tXID: ${txid})`, { type: 'info', durationMs: 30000, closable: true });
                    }
                );
            }
            return response;
        } catch (error) {
            const errorMsg = error?.message || error?.error?.message || '';
            if (errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                // Already handled above - just return
                return;
            }
            
            // Re-throw other errors to be handled by handleSendForm
            throw error;
        }
    };

    // Send a token from a G45-C collection using the Transfer entrypoint
    // For G45-C collections: Tokens are numbered (token_id) within a collection contract
    // This calls the collection contract's Transfer function to transfer a specific token
    DeroNFTApp.prototype.sendCollectionToken = async function(scid, tokenId, toAddress) {
        try {
            if (!this.deroWallet || !this.deroWallet.ws) {
                throw new Error('Wallet not connected.');
            }
            
            // Validate inputs
            if (!scid || scid.length !== 64 || !/^[0-9a-fA-F]+$/.test(scid)) {
                throw new Error('Invalid SCID format.');
            }
            if (!toAddress || !this.isValidAddress || !this.isValidAddress(toAddress)) {
                throw new Error('Invalid recipient address.');
            }

            const tokenValue = parseInt(tokenId, 10);
            if (Number.isNaN(tokenValue)) {
                throw new Error('Token ID must be a number.');
            }
            // Call the collection contract's Transfer entrypoint with token_id
            const scRpc = [
                { name: 'token_id', datatype: 'U', value: tokenValue },
                { name: 'destination', datatype: 'S', value: toAddress },
                { name: 'to', datatype: 'S', value: toAddress }
            ];
            let response;
            try {
                response = await this.callContractEntry(scid, 'Transfer', scRpc);
            } catch (e) {
                const errorMsg = e?.message || e?.error?.message || 'wallet/network error';
                if (errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                    this.showNotification('Transfer cancelled: Permission not granted in Engram.', 'warning');
                } else {
                    this.showError(`Transaction failed: ${errorMsg}`);
                }
                throw e;
            }
            
            // Check for error in response
            if (response?.error) {
                const errorCode = response.error.code;
                const errorMsg = response.error.message || 'Wallet transfer failed';
                
                // Handle permission denied
                if (errorCode === -32043 || errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                    this.showNotification('Transfer cancelled: Permission not granted in Engram.', 'warning');
                    throw new Error('Permission not granted');
                } else {
                    this.showError(`Transaction failed: ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            }
            
            const txid = response?.result?.txid;
            this.showSuccess(`Transfer submitted${txid ? ` (txid: ${txid})` : ''}.`);
            if (txid && this.pollTxConfirmation) {
                this.pollTxConfirmation(txid, { intervalMs: 4000, timeoutMs: 90000 },
                    async () => {
                        await this.ensureTransferAssetCache?.(true);
                        this.showNotification(`Transfer confirmed (tXID: ${txid})`, { type: 'success', durationMs: 30000, closable: true });
                        if (this.currentTab === 'view' && this.assetsCache?.value) {
                            this.renderAssetsWithOrders(this.assetsCache.value);
                        }
                        if (this.currentTab === 'sell') this.loadSellOrders?.();
                        if (this.currentTab === 'buy') this.loadBuyOrders?.();
                    },
                    () => {
                        this.showNotification(`Transaction pending confirmation (tXID: ${txid})`, { type: 'info', durationMs: 30000, closable: true });
                    }
                );
            }
            // Do not change status immediately; rely on on-chain confirmation
            return response;
        } catch (error) {
            const errorMsg = error?.message || error?.error?.message || '';
            if (errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                // Already handled above - just return
                return;
            }
            
            // Re-throw other errors to be handled by handleSendForm
            throw error;
        }
    };

    // Transfer NFA ownership (ART-NFA-MS1 standard)
    // For NFA, balance is always 1 atomic unit, so we need to:
    // 1. Call transferOwnership(newOwner) to change contract owner
    // 2. Transfer the 1 atomic unit balance to the new owner
    // 3. Gnomon.GetOwner will then reflect the ownership change
    DeroNFTApp.prototype.transferNFAOwnership = async function(scid, newOwnerAddress) {
        if (!this.currentAddress) {
            this.showError('Please connect your wallet first');
            return;
        }
        if (!scid || scid.length !== 64 || !/^[0-9a-fA-F]+$/.test(scid)) {
            this.showError('Invalid SCID format.');
            return;
        }
        if (!newOwnerAddress || !this.isValidAddress || !this.isValidAddress(newOwnerAddress)) {
            this.showError('Invalid recipient address.');
            return;
        }

        // Check if this is an NFA asset - but don't block if detection fails
        // We'll try the transfer anyway since the contract will reject it if it's not an NFA
        const asset = { scid: scid };
        let isNFA = this.isArtificerAsset ? this.isArtificerAsset(asset) : false;
        
        // Fallback: Check balance - NFA should have balance of 1
        if (!isNFA) {
            try {
                const balanceCheck = await this.deroWallet?.ws?.sendRequest('GetBalance', { scid: scid });
                const balance = balanceCheck?.result?.balance || 0;
                if (balance === 1) {
                    console.log('📊 [transferNFAOwnership] Balance check confirms NFA (balance = 1)');
                    isNFA = true;
                }
            } catch (balanceError) {
                console.warn('⚠️ [transferNFAOwnership] Could not verify NFA via balance check:', balanceError);
            }
        }
        
        // Warn but don't block - let the contract decide
        if (!isNFA) {
            console.warn('⚠️ [transferNFAOwnership] Asset type detection failed - proceeding anyway (contract will reject if not NFA)');
            const proceed = window.confirm('NFA detection failed. This transfer may only work for NFA assets.\n\nProceed anyway?');
            if (!proceed) return;
        }

        // Confirm transfer
        const confirmed = window.confirm(`Transfer NFA ownership to ${newOwnerAddress}?\n\nThis will:\n1. Change the contract owner to the new address\n2. Transfer the 1 atomic unit balance\n3. You will no longer own this NFA`);
        if (!confirmed) return;

        try {
            // Step 1: Call transferOwnership(newOwner) contract function
            const scRpc = [
                {
                    name: 'newOwner',
                    datatype: 'S',
                    value: newOwnerAddress
                }
            ];
            
            let response;
            try {
                console.log('📤 [transferNFAOwnership] Calling transferOwnership contract function...');
                response = await this.callContractEntry(scid, 'transferOwnership', scRpc);
                console.log('✅ [transferNFAOwnership] transferOwnership response:', response);
            } catch (e) {
                const msg = e?.message || e?.error?.message || 'wallet/network error';
                console.error('❌ [transferNFAOwnership] transferOwnership failed:', e);
                this.showError(`transferOwnership failed: ${msg}`);
                throw e;
            }
            
            const txid1 = response?.result?.txid;
            
            // Step 2: Transfer the 1 atomic unit balance to the new owner
            // For NFA, balance is always 1 atomic unit
            const transferAmount = 1; // 1 atomic unit = 0.00001 DERO
            const params = {
                ringsize: 2,
                transfers: [
                    {
                        destination: newOwnerAddress,
                        amount: transferAmount,
                        scid: scid
                    }
                ]
            };
            
            let transferResponse;
            try {
                console.log('📤 [transferNFAOwnership] Transferring 1 atomic unit balance to new owner...', params);
                transferResponse = await this.deroWallet.ws.sendRequest('transfer', params);
                console.log('✅ [transferNFAOwnership] Balance transfer response:', transferResponse);
            } catch (e) {
                const errorMsg = e?.message || e?.error?.message || 'wallet/network error';
                console.error('❌ [transferNFAOwnership] Balance transfer failed:', e);
                if (errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                    this.showNotification('transferOwnership succeeded, but balance transfer was cancelled: Permission not granted in Engram.', 'warning');
                } else {
                    this.showError(`transferOwnership succeeded, but balance transfer failed: ${errorMsg}`);
                }
                throw e;
            }
            
            // Check for error in transfer response
            if (transferResponse?.error) {
                const errorCode = transferResponse.error.code;
                const errorMsg = transferResponse.error.message || 'Wallet transfer failed';
                
                if (errorCode === -32043 || errorMsg.includes('Permission not granted') || errorMsg.includes('permission')) {
                    this.showNotification('transferOwnership succeeded, but balance transfer was cancelled: Permission not granted in Engram.', 'warning');
                    throw new Error('Permission not granted');
                } else {
                    this.showError(`transferOwnership succeeded, but balance transfer failed: ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            }
            
            const txid2 = transferResponse?.result?.txid;
            this.showSuccess(`NFA ownership transfer submitted:\n- transferOwnership: ${txid1 || 'pending'}\n- Balance transfer: ${txid2 || 'pending'}`);
            
            // Update ownership status optimistically
            try {
                const assetObj = this.findAssetByScid ? this.findAssetByScid(scid) : null;
                if (assetObj) {
                    assetObj.ownershipStatus = 'not-owned';
                    assetObj.owned = false;
                    // Update in saved assets cache
                    if (Array.isArray(this.savedAssets)) {
                        const savedAsset = this.savedAssets.find(a => a.scid === scid);
                        if (savedAsset) {
                            savedAsset.ownershipStatus = 'not-owned';
                            savedAsset.owned = false;
                            this.saveAssets();
                        }
                    }
                    // Update UI
                    if (this.currentTab === 'view' && this.assetsCache?.value) {
                        this.renderAssetsWithOrders(this.assetsCache.value);
                    }
                }
            } catch (e) {
                console.warn('Could not update ownership status optimistically:', e);
            }
            
            // Poll for confirmation
            if (txid1 && this.pollTxConfirmation) {
                this.pollTxConfirmation(txid1, { intervalMs: 4000, timeoutMs: 90000 },
                    async () => {
                        this.showNotification(`NFA ownership transfer confirmed (tXID: ${txid1})`, { type: 'success', durationMs: 30000, closable: true });
                        // Refresh ownership status
                        if (this.currentTab === 'view' && this.assetsCache?.value) {
                            this.renderAssetsWithOrders(this.assetsCache.value);
                        }
                    },
                    () => {
                        this.showNotification(`NFA ownership transfer pending confirmation (tXID: ${txid1})`, { type: 'info', durationMs: 30000, closable: true });
                    }
                );
            }
            
            return { transferOwnershipTxid: txid1, balanceTransferTxid: txid2 };
        } catch (error) {
            if (error.message && error.message.includes('Permission')) {
                this.showNotification(error.message, 'info');
            } else {
                this.showError(`Failed to transfer NFA ownership: ${error.message}`);
            }
            throw error;
        }
    };

    DeroNFTApp.prototype.promptTransferNFAOwnership = function(scid) {
        if (!scid) {
            this.showError('Invalid SCID');
            return;
        }
        
        const newOwnerAddress = prompt('Enter the new owner address (deto1... or dero1...):');
        if (!newOwnerAddress || newOwnerAddress.trim() === '') {
            return;
        }
        
        const trimmedAddress = newOwnerAddress.trim();
        if (!this.isValidAddress || !this.isValidAddress(trimmedAddress)) {
            this.showError('Invalid address format. Please enter a valid DERO address (deto1... or dero1...).');
            return;
        }
        
        this.transferNFAOwnership(scid, trimmedAddress);
    };

    DeroNFTApp.prototype.checkOwnership = async function(index, type) {
        // Simple ownership check - like Engram Calls tab
        if (!this.currentAddress) {
            this.showError('Please connect your wallet first');
            return;
        }

        const results = type === 'collection' ? this.lastCollectionResults : this.lastSearchResults;
        if (!results || !results[index]) {
            this.showError('Asset data not found');
            return;
        }

        const item = results[index];
        if (!item.scid) {
            this.showError('Cannot check ownership: missing SCID');
            return;
        }

        // Show spinner
        if (this.setActionLoading && item) {
            this.setActionLoading(item, 'check-ownership', true);
        }

        try {
            // Step 1: Check private balance first (definitive ownership check)
            // For NFT/NFA, the owner is whoever has the balance, not the contract creator
            let ownershipStatus = 'not-owned';
            let privateBalance = 0;
            
            try {
                if (this.deroWallet && this.deroWallet.getBalance) {
                    privateBalance = await this.deroWallet.getBalance(null, item.scid);
                    if (privateBalance > 0) {
                        ownershipStatus = 'owned';
                    }
                }
            } catch (balanceError) {
                // Continue to Gnomon check as fallback
            }
            
            // Step 2: Update item
            item.ownershipStatus = ownershipStatus;
            item.owned = (ownershipStatus === 'owned');
            
            // Step 3: If asset is in-contract (has an order), update buy/sell tabs
            // Use determineOwnershipStatusForAssetFresh to get full status including in-contract
            if (this.determineOwnershipStatusForAssetFresh) {
                try {
                    const fullStatus = await this.determineOwnershipStatusForAssetFresh(item);
                    item.ownershipStatus = fullStatus;
                    item.owned = (fullStatus === 'owned');
                    
                    // If in-contract, refresh buy/sell tabs to show the order
                    if (fullStatus === 'in-contract') {
                        if (this.loadSellOrders) {
                            this.loadSellOrders();
                        }
                        if (this.loadBuyOrders) {
                            this.loadBuyOrders();
                        }
                    }
                } catch (e) {
                    // Ignore status check errors
                }
            }

            // Step 4: Update results array
            results[index] = item;

            // Step 5: Update status in UI (simple DOM update)
            const assetDomKey = this.getAssetDomKey ? this.getAssetDomKey(item) : null;
            if (assetDomKey) {
                const cardElement = document.querySelector(`[data-asset-id="${assetDomKey}"]`);
                if (cardElement) {
                    const statusElement = cardElement.querySelector('.search-result-status');
                    if (statusElement) {
                        const status = this.getSearchResultStatus ? this.getSearchResultStatus(item, item.isCollection) : { text: 'Unknown', className: 'status-unknown' };
                        statusElement.textContent = status.text;
                        statusElement.className = `search-result-status ${status.className}`;
                    }
                }
            }

            // Step 6: Save to cache (if savedAssets exists)
            if (this.savedAssets && Array.isArray(this.savedAssets)) {
                const savedIndex = this.savedAssets.findIndex(a => a.id === item.id || a.scid === item.scid);
                if (savedIndex >= 0) {
                    this.savedAssets[savedIndex] = item;
                }
            }

            // Step 7: Show notification
            if (ownershipStatus === 'owned') {
                this.showNotification('Asset is owned by the connected wallet.', 'success');
            } else {
                this.showNotification('Asset is not owned by the connected wallet.', 'info');
            }

        } catch (error) {
            this.showNotification(`Ownership check failed: ${error.message || 'Unknown error'}`, 'error');
        } finally {
            // Hide spinner
            if (this.setActionLoading && item) {
                this.setActionLoading(item, 'check-ownership', false);
            }
        }
    }


    DeroNFTApp.prototype.checkOwnershipById = async function(assetId) {
        if (!assetId) {
            this.showError('Asset identifier missing');
            return;
        }
        const asset = this.findAssetById ? this.findAssetById(assetId) : null;
        if (!asset) {
            this.showError('Asset data not found');
            return;
        }

        const isCollection = asset.isCollection || (asset.type || '').toLowerCase() === 'collection';
        const listName = isCollection ? 'lastCollectionResults' : 'lastSearchResults';
        const contextType = isCollection ? 'collection' : 'search';
        this[listName] = Array.isArray(this[listName]) ? this[listName] : [];

        let index = this[listName].findIndex(item => item && item.id === asset.id);
        let added = false;
        if (index === -1) {
            this[listName].push(asset);
            index = this[listName].length - 1;
            added = true;
        }

        try {
            await this.checkOwnership(index, contextType);
        } finally {
            if (added) {
                this[listName].splice(index, 1);
            }
        }
    };

    DeroNFTApp.prototype.displayNFT = async function(scid, tokenId) {
        if (!this.currentAddress) {
            this.showError('Please connect your wallet first');
            return;
        }
        if (!scid) {
            this.showError('Invalid NFT SCID');
            return;
        }

        // Check if this is an NFA asset - Display/Retrieve is only available for G45 NFT standard
        // NFA assets (ART-NFA-MS1) don't support DisplayToken/RetrieveToken functions
        const asset = { scid: scid, tokenId: tokenId };
        if (this.isArtificerAsset && this.isArtificerAsset(asset)) {
            this.showNotification('Display/Retrieve is not available for NFA assets (ART-NFA-MS1 standard). NFA assets use listing functions instead.', 'info');
            return;
        }

        try {
            // IMPORTANT: NFT asset balance is fixed and represents ownership
            // 1 owner = 100,000 atomic units (never changes)
            // ORED ALWAYS uses 100,000 atomic units for NFT transfers, regardless of what was displayed
            // This is the asset balance being transferred, NOT a price
            const DISPLAY_AMOUNT = 100000; // Fixed: 100,000 atomic units = 1 NFT owner (ALWAYS - cannot be overridden)
            
            // No need to check balance - transaction will fail if insufficient
            // User can check balance in Engram's calls tab if transaction fails

            const normalizedScid = scid.toLowerCase().trim();
            
            try {
                await this.deroWallet.ws.getSC(normalizedScid);
            } catch (error) {
                // Ignore SC validation errors
            }

            const params = [];
            // Use 'burn' parameter for asset transfers to contracts (per DERO docs)
            // CLI wallet should support this, but if it fails, we'll get a clear error
            const transfers = [{
                scid: normalizedScid,
                burn: DISPLAY_AMOUNT
            }];

            let response;
            try {
                response = await this.callContractEntry(normalizedScid, 'DisplayToken', params, { transfers: transfers });
            } catch (e) {
                const errorMsg = e?.message || 'wallet/network error';
                // Check if error is about insufficient funds - might be balance check issue
                if (errorMsg.includes('Insufficent funds') || errorMsg.includes('Insufficient funds')) {
                    this.showError(`Insufficient NFT balance. You need 100,000 atomic units (1 NFT) but your wallet shows insufficient balance. Please check your NFT balance in your wallet.`);
                } else {
                    this.showError(`Transaction failed: ${errorMsg}`);
                }
                throw e;
            }
            const txid = response?.result?.txid;
            if (txid) {
                this.showSuccess(`Display request sent (txid: ${txid}). Please approve in wallet if prompted.`);
                // Wait for block confirmation then verify the NFT is actually displayed
                setTimeout(async () => {
                    try {
                        // Verify the NFT is in the contract
                        const scResult = await this.deroWallet.ws.getSC(normalizedScid);
                        const scData = scResult?.result || scResult;
                        const stringKeys = scData?.stringkeys || {};
                        const uint64Keys = scData?.uint64keys || {};
                        
                        let found = false;
                        const currentAddress = this.currentAddress || '';
                        if (currentAddress) {
                            const addressVariants = [
                                currentAddress.toLowerCase(),
                                currentAddress.toLowerCase().substring(0, 50),
                                currentAddress.replace(/^dero1|^deto1/, '').toLowerCase()
                            ];
                            
                            for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                                const keyLower = rawKey.toLowerCase();
                                if (keyLower.startsWith('owner_')) {
                                    const ownerAddr = rawKey.substring(6);
                                    for (const variant of addressVariants) {
                                        if (ownerAddr.toLowerCase().includes(variant) || variant.includes(ownerAddr.toLowerCase().substring(0, 50))) {
                                            let amount = 0;
                                            if (uint64Keys[rawKey] !== undefined) {
                                                amount = parseInt(uint64Keys[rawKey], 10) || 0;
                                            } else if (rawValue) {
                                                amount = parseInt(rawValue, 10) || parseInt(rawValue, 16) || 0;
                                            }
                                            if (amount >= 100000) {
                                                found = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (found) break;
                                }
                            }
                        }
                        
                        if (!found) {
                            this.showNotification(`⚠️ Display transaction sent but NFT not found in contract. Use "Debug Missing NFT" in Wallet Calls tab to investigate.`, 'warning');
                        } else {
                            this.markAssetDisplayStatus(scid, tokenId, true);
                        }
                    } catch (error) {
                        this.markAssetDisplayStatus(scid, tokenId, true);
                    }
                }, 5000); // Wait 5 seconds for block confirmation
            } else {
                this.showSuccess(`Display request sent. Please approve in wallet if prompted.`);
                this.markAssetDisplayStatus(scid, tokenId, true);
            }
        } catch (error) {
            if (error.message && error.message.includes('Permission')) {
                this.showNotification(error.message, 'info');
            } else {
                this.showError(`Failed to display NFT: ${error.message}`);
            }
        }
    }

    DeroNFTApp.prototype.retrieveNFTPrompt = function(scid, tokenId) {
        this.retrieveNFT(scid, null, tokenId);
    }

    DeroNFTApp.prototype.markAssetDisplayStatus = function(scid, tokenId, displayed = true) {
        const normalize = (value) => value ? String(value).toLowerCase() : '';
        const targetScid = normalize(scid);
        const targetToken = tokenId !== undefined && tokenId !== null && tokenId !== '' ? String(tokenId) : '';

        const matches = (asset) => {
            if (!asset) return false;
            const assetScid = normalize(asset.scid || asset.collection_scid || '');
            const assetToken = asset.tokenId !== undefined && asset.tokenId !== null && asset.tokenId !== '' ? String(asset.tokenId) : '';
            if (!assetScid || assetScid !== targetScid) return false;
            if (targetToken && assetToken && assetToken !== targetToken) return false;
            return true;
        };

        const updateList = (list) => {
            if (!Array.isArray(list)) return false;
            let updated = false;
            list.forEach(asset => {
                if (matches(asset)) {
                    asset.displayed = displayed;
                    if (displayed) {
                        asset.displayStatus = 'displayed';
                    } else {
                        delete asset.displayStatus;
                    }
                    updated = true;
                }
            });
            return updated;
        };

        let changed = false;
        if (updateList(this.savedAssets)) {
            changed = true;
            this.saveAssets();
        }

        const cacheValue = this.assetsCache?.value;
        if (Array.isArray(cacheValue)) {
            changed = updateList(cacheValue) || changed;
        } else if (cacheValue && Array.isArray(cacheValue.nfts)) {
            changed = updateList(cacheValue.nfts) || changed;
        }

        changed = updateList(this.lastSearchResults) || changed;
        changed = updateList(this.lastCollectionResults) || changed;

        if (changed) {
            if (this.currentTab === 'view' && this.assetsCache?.value) {
                this.renderAssetsWithOrders(this.assetsCache.value);
            } else if (this.currentTab === 'search' && Array.isArray(this.lastSearchResults)) {
                this.renderSearchResults(this.lastSearchResults);
            } else if (this.currentTab === 'view' && Array.isArray(this.savedAssets)) {
                this.renderAssetsWithOrders(this.savedAssets);
            }
        }
    }

    DeroNFTApp.prototype.retrieveNFT = async function(scid, amount, tokenId) {
        if (!this.currentAddress) {
            this.showError('Please connect your wallet first');
            return;
        }

        if (!scid) {
            this.showError('Invalid NFT SCID');
            return;
        }

        // Check if this is an NFA asset - Display/Retrieve is only available for G45 NFT standard
        // NFA assets (ART-NFA-MS1) don't support DisplayToken/RetrieveToken functions
        const asset = { scid: scid, tokenId: tokenId };
        if (this.isArtificerAsset && this.isArtificerAsset(asset)) {
            this.showNotification('Display/Retrieve is not available for NFA assets (ART-NFA-MS1 standard). NFA assets use listing functions instead.', 'info');
            return;
        }

        try {
            const RETRIEVE_AMOUNT = 100000;
            const retrieveAmount = RETRIEVE_AMOUNT;
            const params = [
                {
                    name: 'amount',
                    datatype: 'U',
                    value: retrieveAmount
                }
            ];

            let response;
            try {
                response = await this.callContractEntry(scid, 'RetrieveToken', params);
            } catch (e) {
                const msg = e?.message || 'wallet/network error';
                // Check if error indicates insufficient balance in contract
                if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('amount')) {
                    this.showError(`Retrieve failed: Contract does not have ${retrieveAmount} atomic units available. The NFT may not be displayed.`);
                } else {
                this.showError(`Transaction failed: ${msg}`);
                }
                throw e;
            }
            const txid = response?.result?.txid;
            if (txid) {
                this.showSuccess(`Retrieve request sent (txid: ${txid}). The contract will send ${retrieveAmount} atomic units back to your wallet.`);
                // Mark as not displayed and refresh balance after a short delay
                this.markAssetDisplayStatus(scid, tokenId, false);
                // Wait for block confirmation then refresh balance to detect the returned assets
                setTimeout(async () => {
                    try {
                        await this.deroWallet.getBalance(this.currentAddress, scid);
                        if (this.loadAssets) {
                            await this.loadAssets(true);
                        }
                        if (this.determineOwnershipStatusForAssetFresh) {
                            const asset = { scid: scid, tokenId: tokenId };
                            await this.determineOwnershipStatusForAssetFresh(asset, scid);
                        }
                    } catch (error) {
                        // Ignore refresh errors
                    }
                }, 5000);
            } else {
                this.showSuccess(`Retrieve request sent. Please approve in wallet if prompted.`);
                this.markAssetDisplayStatus(scid, tokenId, false);
            }
        } catch (error) {
            if (error.message && error.message.includes('Permission')) {
                this.showNotification(error.message, 'info');
            } else {
                this.showError(`Failed to retrieve NFT: ${error.message}`);
            }
        }
    }

}

