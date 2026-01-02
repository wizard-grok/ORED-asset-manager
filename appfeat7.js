if (typeof DeroNFTApp !== 'undefined') {

    /* ------------------------------------------------------------------
     * Token Transfer Functions
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.transferToken = async function(token) {
        try {
            if (!this.currentAddress) {
                this.showError?.('Please connect your wallet first.');
                return;
            }
            
            if (!token || !token.scid) {
                this.showError?.('Invalid token data');
                return;
            }
            
            // Show modal with form for recipient address and amount
            this.showTokenTransferModal(token);
        } catch (error) {
            const msg = error?.message || 'wallet/network error';
            this.showError?.(`Transfer failed: ${msg}`);
        }
    };

    DeroNFTApp.prototype.showTokenTransferModal = function(token) {
        // Remove existing modal if any
        const existing = document.getElementById('tokenTransferModal');
        if (existing) {
            existing.remove();
        }
        
        const tokenName = token.name || token.ticker || token.scid.substring(0, 8) + '...';
        const tokenBalance = token.balanceFormatted || '0';
        
        const modalHtml = `
            <div class="modal active" id="tokenTransferModal" onclick="if(event.target.id === 'tokenTransferModal') app.hideTokenTransferModal()">
                <div class="modal-content" style="max-width: 500px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">Transfer ${tokenName}</h2>
                        <button class="btn btn-secondary" onclick="app.hideTokenTransferModal()" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div style="margin-bottom: 15px; color: #aaa; font-size: 0.9rem;">
                        <p style="margin: 0;"><strong>Token SCID:</strong> ${token.scid}</p>
                        <p style="margin: 0;"><strong>Your Balance:</strong> ${tokenBalance}</p>
                    </div>
                    <form id="tokenTransferForm" onsubmit="app.submitTokenTransfer(event, '${token.scid}'); return false;">
                        <div class="form-group" style="margin-bottom: 15px;">
                            <label for="tokenRecipientAddress" style="display: block; margin-bottom: 5px; font-weight: bold;">Recipient Address:</label>
                            <input 
                                type="text" 
                                id="tokenRecipientAddress" 
                                class="form-input" 
                                placeholder="Enter DERO address (64 hex or dero1...)" 
                                required
                                style="width: 100%;"
                            >
                            <small style="color: #aaa; font-size: 0.85rem;">64 hex characters or dero1... format</small>
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label for="tokenTransferAmount" style="display: block; margin-bottom: 5px; font-weight: bold;">Amount (whole units):</label>
                            <input 
                                type="number" 
                                id="tokenTransferAmount" 
                                class="form-input" 
                                placeholder="Enter amount" 
                                step="0.000001"
                                min="0.000001"
                                required
                                style="width: 100%;"
                            >
                            <small style="color: #aaa; font-size: 0.85rem;">Enter amount in whole token units</small>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="app.hideTokenTransferModal()" style="flex: 1;">
                                Cancel
                            </button>
                            <button type="submit" class="btn btn-primary" style="flex: 1;">
                                <i class="fas fa-paper-plane"></i> Send Transaction
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Focus on recipient address input
        setTimeout(() => {
            const input = document.getElementById('tokenRecipientAddress');
            if (input) input.focus();
        }, 100);
    };

    DeroNFTApp.prototype.hideTokenTransferModal = function() {
        const modal = document.getElementById('tokenTransferModal');
        if (modal) {
            modal.remove();
        }
    };

    DeroNFTApp.prototype.submitTokenTransfer = async function(event, tokenScid) {
        event.preventDefault();
        
        try {
            if (!this.currentAddress) {
                this.showError?.('Please connect your wallet first.');
                return;
            }
            
            const recipientAddress = document.getElementById('tokenRecipientAddress').value.trim();
            const amountInput = document.getElementById('tokenTransferAmount').value.trim();
            
            if (!recipientAddress || recipientAddress.length === 0) {
                this.showError?.('Please enter a recipient address.');
                return;
            }
            
            if (!amountInput || amountInput.length === 0) {
                this.showError?.('Please enter an amount.');
                return;
            }
            
            // Validate address format
            const normalizedRecipient = recipientAddress.toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(normalizedRecipient) && !normalizedRecipient.startsWith('dero1') && !normalizedRecipient.startsWith('deto1')) {
                this.showError?.('Invalid DERO address format. Must be 64 hexadecimal characters or start with "dero1"/"deto1".');
                return;
            }
            
            const amountWhole = parseFloat(amountInput);
            if (Number.isNaN(amountWhole) || amountWhole <= 0) {
                this.showError?.('Enter a valid amount greater than 0.');
                return;
            }
            
            // Convert whole units to atomic units (1 token = 100,000 atomic units)
            const amountAtomic = Math.floor(amountWhole * 100000);
            
            // Check balance
            let balance = 0;
            try {
                balance = await this.deroWallet.getBalance(null, tokenScid);
                if (balance < amountAtomic) {
                    const balanceFormatted = this.formatTokenAmount ? this.formatTokenAmount(balance) : (balance / 100000).toFixed(6);
                    this.showError?.(`Insufficient balance. You have ${balanceFormatted} but trying to send ${amountWhole}.`);
                    return;
                }
            } catch (error) {
                this.showError?.('Could not verify token balance. Please try again.');
                return;
            }
            
            // Normalize SCID
            const normalizedTokenScid = tokenScid.toLowerCase().trim();
            
            // Determine destination address format
            let destinationAddress = normalizedRecipient;
            if (normalizedRecipient.startsWith('dero1') || normalizedRecipient.startsWith('deto1')) {
                // Integrated address - use as-is
                destinationAddress = normalizedRecipient;
            } else if (!/^[0-9a-f]{64}$/.test(normalizedRecipient)) {
                this.showError?.('Invalid DERO address format.');
                return;
            }
            
            // Validate token SCID exists before transfer (helps wallet recognize it)
            try {
                const scResult = await this.deroWallet.ws.getSC(normalizedTokenScid);
                if (scResult && scResult.error) {
                } else if (scResult && (scResult.result || scResult.status === 'OK')) {
                    // Delay to ensure wallet has processed the SCID in its state tree
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } catch (error) {
            }
            
            // Create transfer - for address transfers, we need destination
            const params = {
                ringsize: 2,
                transfers: [
                    {
                        destination: destinationAddress,
                        scid: normalizedTokenScid,
                        amount: amountAtomic
                    }
                ]
            };
            
            
            // Close modal and show notification
            this.hideTokenTransferModal();
            this.showNotification?.('Requesting wallet approval...', 'info');
            
            try {
                // Use lowercase 'transfer' method as per XSWD API
                const response = await this.deroWallet.ws.sendRequest('transfer', params);
                
                if (response && response.error) {
                    throw new Error(response.error.message || 'Transfer failed');
                }
                
                const txid = response?.result?.txid;
                if (txid) {
                    this.showSuccess?.(`Token transfer submitted (txid: ${txid}). Please approve in wallet if prompted.`);
                    // Refresh token balance after a delay
                    setTimeout(() => {
                        if (this.refreshTokenBalance) {
                            const token = { scid: tokenScid };
                            this.refreshTokenBalance(token);
                        }
                    }, 3000);
                } else {
                    this.showSuccess?.(`Token transfer request sent. Please approve in wallet if prompted.`);
                }
            } catch (error) {
                throw error; // Re-throw to be caught by outer catch
            }
        } catch (error) {
            const msg = error?.message || 'wallet/network error';
            this.showError?.(`Transfer failed: ${msg}`);
        }
    };

    /* ------------------------------------------------------------------
     * Token Order Creation Wrappers
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.createTokenSellOrderFromToken = function(token) {
        if (!token || !token.scid) {
            this.showError?.('Invalid token data');
            return;
        }
        // Call the modal function from appfeat6.js
        if (this.showTokenSellOrderModal) {
            this.showTokenSellOrderModal(token);
        }
    };

    DeroNFTApp.prototype.createTokenBuyOrderFromToken = function(token) {
        if (!token || !token.scid) {
            this.showError?.('Invalid token data');
            return;
        }
        // Call the modal function from appfeat6.js
        if (this.showTokenBuyOrderModal) {
            this.showTokenBuyOrderModal(token);
        }
    };

    /* ------------------------------------------------------------------
     * Token Balance Refresh
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.refreshTokenBalance = async function(token) {
        if (!token || !token.scid) {
            this.showError?.('Invalid token data');
            return;
        }
        
        if (!this.currentAddress) {
            this.showError?.('Please connect your wallet first.');
            return;
        }
        
        // Check WebSocket connection before attempting balance check
        if (!this.deroWallet || !this.deroWallet.ws) {
            this.showError?.('Wallet WebSocket not connected. Please reconnect your wallet.');
            return;
        }
        
        if (!this.deroWallet.ws.isConnected || !this.deroWallet.ws.isAuthenticated) {
            this.showError?.('Wallet not authenticated. Please reconnect your wallet.');
            return;
        }
        
        this.showNotification?.('Refreshing balance...', 'info');
        
        try {
            const normalizedScid = token.scid.toLowerCase().trim();
            
            // Fetch balance
            let balanceAtomic = 0;
            if (this.deroWallet && this.deroWallet.getBalance) {
                balanceAtomic = await this.deroWallet.getBalance(null, normalizedScid);
                balanceAtomic = Number(balanceAtomic) || 0;
            }
            
            // Update the token object in savedTokens array
            if (Array.isArray(this.savedTokens)) {
                const tokenIndex = this.savedTokens.findIndex(t => t.scid === token.scid);
                if (tokenIndex >= 0) {
                    this.savedTokens[tokenIndex].balanceAtomic = balanceAtomic;
                    this.savedTokens[tokenIndex].balanceFormatted = this.formatTokenAmount ? this.formatTokenAmount(balanceAtomic, token.decimals || 0) : '0';
                    this.saveTokens();
                }
            }
            
            // Update the token object passed in
            token.balanceAtomic = balanceAtomic;
            token.balanceFormatted = this.formatTokenAmount ? this.formatTokenAmount(balanceAtomic, token.decimals || 0) : '0';
            
            // Update the display
            const row = document.querySelector(`.token-row[data-scid="${normalizedScid}"]`);
            if (row) {
                const balanceValue = row.querySelector('.token-balance-value');
                if (balanceValue) {
                    balanceValue.textContent = token.balanceFormatted;
                }
                const balanceAtomicEl = row.querySelector('.token-balance-atomic');
                if (balanceAtomicEl) {
                    balanceAtomicEl.textContent = `${balanceAtomic} atomic`;
                }
            }
            
            // Re-render the token list to ensure display is updated
            if (this.loadSavedTokensForDisplay) {
                await this.loadSavedTokensForDisplay();
            }
            
            this.showSuccess?.('Balance refreshed');
        } catch (error) {
            this.showError?.(`Failed to refresh balance: ${error.message || 'Unknown error'}`);
        }
    };

    /* ------------------------------------------------------------------
     * Token Details Popup with Graph and Orders
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.showTokenDetailsPopup = async function(token) {
        if (!token || !token.scid) {
            this.showError?.('Invalid token data');
            return;
        }
        
        // Remove existing popup if any
        const existing = document.getElementById('tokenDetailsPopup');
        if (existing) {
            existing.remove();
        }
        
        this._openTokenDetailsScid = token.scid;
        
        // Show loading popup first
        const loadingHtml = `
            <div class="modal active" id="tokenDetailsPopup" onclick="if(event.target.id === 'tokenDetailsPopup') app.hideTokenDetailsPopup()">
                <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">Token Details - ${token.name || token.ticker || token.scid.substring(0, 8) + '...'}</h2>
                        <button class="btn btn-secondary" onclick="app.hideTokenDetailsPopup()" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div style="text-align: center; padding: 40px;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #666;"></i>
                        <p style="margin-top: 15px;">Loading token orders and price data...</p>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loadingHtml);
        
        // Load token details
        await this.loadTokenDetailsPopup(token.scid, token);
    };

    DeroNFTApp.prototype.hideTokenDetailsPopup = function() {
        const popup = document.getElementById('tokenDetailsPopup');
        if (popup) {
            popup.remove();
        }
        this._openTokenDetailsScid = null;
    };

    DeroNFTApp.prototype.loadTokenDetailsPopup = async function(tokenScid, tokenData = null) {
        try {
            if (!this.deroWallet || !this.deroWallet.ws) {
                this.showError?.('Wallet not connected');
                return;
            }
            
            const marketScid = this.ensureTokenMarketplaceScid ? this.ensureTokenMarketplaceScid(false) : '';
            if (!marketScid || marketScid.length !== 64) {
                this.showError?.('Token marketplace SCID is not configured.');
                return;
            }
            
            // Get token data if not provided
            let token = tokenData;
            if (!token) {
                token = { scid: tokenScid };
                try {
                    const details = await this.fetchTokenDetails ? this.fetchTokenDetails(tokenScid) : null;
                    if (details) {
                        token = { ...token, ...details };
                    }
                } catch (error) {
                }
            }
            
            // Get balance
            let balance = 0;
            try {
                balance = await this.deroWallet.getBalance(null, tokenScid);
            } catch (error) {
            }
            
            // Query marketplace for orders
            const allBuyOrders = [];
            const allSellOrders = [];
            const myBuyOrders = [];
            const mySellOrders = [];
            const priceHistory = [];
            
            try {
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
                    if (!Number.isNaN(p)) return p;
                    const h = parseInt(raw, 16);
                    return Number.isNaN(h) ? 0 : h;
                };
                
                // Query buy orders - scan using order_counter
                const orderCounter = decU('order_counter');
                const maxScan = Math.min(orderCounter || 1000, 1000);
                for (let id = 1; id <= maxScan; id++) {
                    const buyer = decS(`buy_order_buyer_${id}`); // Contract format: buy_order_buyer_${id}
                    const tokenScidFromOrder = decS(`buy_order_token_${id}`);
                    const price = decU(`buy_order_price_${id}`);
                    const amount = decU(`buy_order_amount_${id}`);
                    const statusRaw = decS(`buy_order_status_${id}`); // Contract stores as "active", "filled", etc.
                    const status = statusRaw === 'active' ? 0 : statusRaw === 'filled' ? 1 : 2;
                    const created = decU(`buy_order_created_${id}`); // Contract format: buy_order_created_${id}
                    
                    // Filter by token SCID
                    if (tokenScidFromOrder && tokenScidFromOrder.toLowerCase() === tokenScid.toLowerCase() && buyer) {
                        const order = {
                            id: id,
                            buyer: buyer,
                            price: price / 100000, // Convert to DERO
                            amount: amount / 100000, // Convert to whole units
                            status: status === 0 ? 'active' : status === 1 ? 'filled' : 'cancelled',
                            created: created,
                            pricePerToken: amount > 0 ? (price / amount) : 0
                        };
                        allBuyOrders.push(order);
                        if (buyer && this.currentAddress && buyer.toLowerCase() === this.currentAddress.toLowerCase()) {
                            myBuyOrders.push(order);
                        }
                        if (status === 0 && order.pricePerToken > 0) {
                            priceHistory.push({ price: order.pricePerToken, time: created, type: 'buy' });
                        }
                    }
                }
                
                // Query sell orders - scan from order_counter backwards to find most recent orders first
                // Also check sell_counter if it exists (some contracts use separate counters)
                const sellCounter = decU('sell_counter');
                const actualMaxOrderId = Math.max(orderCounter || 0, sellCounter || 0);
                
                // Scan from the highest order ID backwards (most recent first)
                // Scan up to 500 orders to ensure we don't miss any
                const scanLimit = Math.min(actualMaxOrderId || 1000, 1000);
                const startId = Math.max(1, scanLimit - 500);
                
                for (let id = scanLimit; id >= startId; id--) {
                    const seller = decS(`sell_order_seller_${id}`); // Contract format: sell_order_seller_${id}
                    const tokenScidFromOrder = decS(`sell_order_token_${id}`);
                    const price = decU(`sell_order_price_${id}`);
                    const amount = decU(`sell_order_amount_${id}`);
                    const statusRaw = decS(`sell_order_status_${id}`); // Contract stores as "active", "filled", etc.
                    const status = statusRaw === 'active' ? 0 : statusRaw === 'filled' ? 1 : 2;
                    const created = decU(`sell_order_created_${id}`); // Contract format: sell_order_created_${id}
                    
                    // Filter by token SCID
                    if (tokenScidFromOrder && tokenScidFromOrder.toLowerCase() === tokenScid.toLowerCase() && seller) {
                        const order = {
                            id: id,
                            seller: seller,
                            price: price / 100000, // Convert to DERO
                            amount: amount / 100000, // Convert to whole units
                            status: status === 0 ? 'active' : status === 1 ? 'filled' : 'cancelled',
                            created: created,
                            pricePerToken: amount > 0 ? (price / amount) : 0
                        };
                        allSellOrders.push(order);
                        
                        // Normalize addresses for comparison
                        const normalizeAddress = (addr) => {
                            if (!addr) return '';
                            const lower = addr.toLowerCase();
                            if (lower.startsWith('dero1') || lower.startsWith('deto1')) {
                                return lower.substring(5);
                            }
                            return lower;
                        };
                        
                        if (seller && this.currentAddress) {
                            const normalizedSeller = normalizeAddress(seller);
                            const normalizedCurrent = normalizeAddress(this.currentAddress);
                            if (normalizedSeller === normalizedCurrent) {
                                mySellOrders.push(order);
                            }
                        }
                        if (status === 0 && order.pricePerToken > 0) {
                            priceHistory.push({ price: order.pricePerToken, time: created, type: 'sell' });
                        }
                    }
                }
            } catch (error) {
            }
            
            // Sort orders by price
            allBuyOrders.sort((a, b) => b.pricePerToken - a.pricePerToken); // Highest first
            allSellOrders.sort((a, b) => a.pricePerToken - b.pricePerToken); // Lowest first
            
            // Render popup
            this.renderTokenDetailsPopup(token, balance, allBuyOrders, allSellOrders, myBuyOrders, mySellOrders, priceHistory);
        } catch (error) {
            this.showError?.(`Failed to load token details: ${error.message}`);
            this.hideTokenDetailsPopup();
        }
    };

    DeroNFTApp.prototype.renderTokenDetailsPopup = function(token, balance, buyOrders, sellOrders, myBuyOrders, mySellOrders, priceHistory) {
        const popup = document.getElementById('tokenDetailsPopup');
        if (!popup) return;
        
        const tokenName = token.name || token.ticker || token.scid.substring(0, 8) + '...';
        const balanceFormatted = this.formatTokenAmount ? this.formatTokenAmount(balance) : (balance / 100000).toFixed(6);
        
        // Simple price graph (line chart using divs)
        let graphHtml = '<div style="height: 200px; background: #1a1a1a; border-radius: 8px; padding: 15px; margin-bottom: 20px;">';
        if (priceHistory.length > 0) {
            // Simple line graph using divs
            const prices = priceHistory.map(p => p.price);
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const range = maxPrice - minPrice || 1;
            
            graphHtml += '<div style="display: flex; align-items: flex-end; height: 150px; gap: 2px;">';
            priceHistory.forEach((point, index) => {
                const height = ((point.price - minPrice) / range) * 100;
                const color = point.type === 'buy' ? '#4CAF50' : '#F44336';
                graphHtml += `<div style="flex: 1; background: ${color}; height: ${height}%; min-height: 2px; border-radius: 2px 2px 0 0;" title="Price: ${point.price.toFixed(6)} DERO"></div>`;
            });
            graphHtml += '</div>';
            graphHtml += `<div style="margin-top: 10px; font-size: 0.85rem; color: #aaa;">Price Range: ${minPrice.toFixed(6)} - ${maxPrice.toFixed(6)} DERO</div>`;
        } else {
            graphHtml += '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">No price history available</div>';
        }
        graphHtml += '</div>';
        
        // Render orders
        const renderOrder = (order, type) => {
            const address = type === 'buy' ? order.buyer : order.seller;
            const isMine = address && this.currentAddress && address.toLowerCase() === this.currentAddress.toLowerCase();
            return `
                <div class="order-row" style="padding: 10px; border-bottom: 1px solid #333; ${isMine ? 'background: #2a2a2a;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: bold; color: ${type === 'buy' ? '#4CAF50' : '#F44336'};">
                                ${type === 'buy' ? 'BUY' : 'SELL'} - ${order.pricePerToken.toFixed(6)} DERO/token
                            </div>
                            <div style="font-size: 0.85rem; color: #aaa; margin-top: 4px;">
                                Amount: ${order.amount.toFixed(6)} | Total: ${(order.pricePerToken * order.amount).toFixed(6)} DERO
                            </div>
                            <div style="font-size: 0.75rem; color: #666; margin-top: 2px;">
                                ${address ? address.substring(0, 16) + '...' : 'Unknown'} | Status: ${order.status}
                            </div>
                        </div>
                        ${isMine ? '<span style="color: #4CAF50; font-size: 0.85rem;">(My Order)</span>' : ''}
                    </div>
                </div>
            `;
        };
        
        const popupHtml = `
            <div class="modal active" id="tokenDetailsPopup" onclick="if(event.target.id === 'tokenDetailsPopup') app.hideTokenDetailsPopup()">
                <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <div>
                            <h2 style="margin: 0;">${tokenName}</h2>
                            <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #aaa;">SCID: ${token.scid}</p>
                        </div>
                        <button class="btn btn-secondary" onclick="app.hideTokenDetailsPopup()" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                        <div style="background: #2a2a2a; padding: 15px; border-radius: 8px;">
                            <div style="font-size: 0.9rem; color: #aaa; margin-bottom: 5px;">Your Balance</div>
                            <div style="font-size: 1.5rem; font-weight: bold;">${balanceFormatted}</div>
                        </div>
                        <div style="background: #2a2a2a; padding: 15px; border-radius: 8px;">
                            <div style="font-size: 0.9rem; color: #aaa; margin-bottom: 5px;">Active Orders</div>
                            <div style="font-size: 1.5rem; font-weight: bold;">${myBuyOrders.length + mySellOrders.length}</div>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <h3 style="margin-bottom: 10px;">Price History</h3>
                        ${graphHtml}
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                        <div>
                            <h3 style="margin-bottom: 10px;">Buy Orders (${buyOrders.length})</h3>
                            <div style="background: #1a1a1a; border-radius: 8px; max-height: 300px; overflow-y: auto;">
                                ${buyOrders.length > 0 ? buyOrders.map(o => renderOrder(o, 'buy')).join('') : '<div style="padding: 20px; text-align: center; color: #666;">No buy orders</div>'}
                            </div>
                        </div>
                        <div>
                            <h3 style="margin-bottom: 10px;">Sell Orders (${sellOrders.length})</h3>
                            <div style="background: #1a1a1a; border-radius: 8px; max-height: 300px; overflow-y: auto;">
                                ${sellOrders.length > 0 ? sellOrders.map(o => renderOrder(o, 'sell')).join('') : '<div style="padding: 20px; text-align: center; color: #666;">No sell orders</div>'}
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <h3 style="margin-bottom: 10px;">My Orders (${myBuyOrders.length + mySellOrders.length})</h3>
                        <div style="background: #1a1a1a; border-radius: 8px; max-height: 300px; overflow-y: auto;">
                            ${myBuyOrders.length + mySellOrders.length > 0 
                                ? [...myBuyOrders.map(o => renderOrder(o, 'buy')), ...mySellOrders.map(o => renderOrder(o, 'sell'))].join('')
                                : '<div style="padding: 20px; text-align: center; color: #666;">No active orders</div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        popup.outerHTML = popupHtml;
    };

    /* ------------------------------------------------------------------
     * Token Storage Functions
     * Moved from appcore.js to reduce file size
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.loadSavedTokens = function() {
        try {
            const saved = localStorage.getItem(this.savedTokensKey);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (error) {
        }
        return [];
    };

    DeroNFTApp.prototype.saveTokens = function() {
        try {
            localStorage.setItem(this.savedTokensKey, JSON.stringify(this.savedTokens));
        } catch (error) {
        }
    };

    /* ------------------------------------------------------------------
     * Token Marketplace SCID Management
     * Moved from appcore.js to reduce file size
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.loadMarketplaceConfig = function() {
        const NEW_TOKEN_MARKETPLACE_SCID = '890fa1ad517eeaf71035a3e69a4e2b4ca085efb82172e39e4f64990d81d2a7d5';
        const NEW_G45_MARKETPLACE_SCID = 'e25c50680feb0b89eb6b640100fd92b49698c0e0c62681f0c3c5ee899d096aea';
        const OLD_TOKEN_MARKETPLACE_SCID = '96f317d4e30e6329b6216fc5be5c3904429f79ff5b202405f8c382c950857b98';
        
        try {
            const raw = localStorage.getItem('ored_market_config');
            if (raw) {
                const config = JSON.parse(raw);
                
                // Auto-update old SCIDs to new ones
                let updated = false;
                
                if (config.tokenMarketplaceScid === OLD_TOKEN_MARKETPLACE_SCID || 
                    (config.tokenMarketplaceScid && config.tokenMarketplaceScid !== NEW_TOKEN_MARKETPLACE_SCID && config.tokenMarketplaceScid.length === 64)) {
                    config.tokenMarketplaceScid = NEW_TOKEN_MARKETPLACE_SCID;
                    updated = true;
                } else if (!config.tokenMarketplaceScid) {
                    config.tokenMarketplaceScid = NEW_TOKEN_MARKETPLACE_SCID;
                    updated = true;
                }
                
                if (config.g45MarketplaceScid && config.g45MarketplaceScid !== NEW_G45_MARKETPLACE_SCID && config.g45MarketplaceScid.length === 64) {
                    config.g45MarketplaceScid = NEW_G45_MARKETPLACE_SCID;
                    updated = true;
                } else if (!config.g45MarketplaceScid) {
                    config.g45MarketplaceScid = NEW_G45_MARKETPLACE_SCID;
                    updated = true;
                }
                
                if (updated) {
                    localStorage.setItem('ored_market_config', JSON.stringify(config));
                }
                
                return config;
            }
        } catch (error) {
        }
        return {
            g45MarketplaceScid: NEW_G45_MARKETPLACE_SCID,
            nfaMarketScids: {},
            tokenMarketplaceScid: NEW_TOKEN_MARKETPLACE_SCID
        };
    };

    DeroNFTApp.prototype.saveMarketplaceConfig = function() {
        try {
            localStorage.setItem('ored_market_config', JSON.stringify(this.marketConfig || {}));
        } catch (error) {
        }
    };

    DeroNFTApp.prototype.ensureTokenMarketplaceScid = function(promptUser = true) {
        if (!this.marketConfig) {
            this.marketConfig = this.loadMarketplaceConfig ? this.loadMarketplaceConfig() : { g45MarketplaceScid: '', nfaMarketScids: {}, tokenMarketplaceScid: '' };
        }
        // ALWAYS use the new token marketplace SCID - no old SCIDs allowed
        const NEW_TOKEN_MARKETPLACE_SCID = '890fa1ad517eeaf71035a3e69a4e2b4ca085efb82172e39e4f64990d81d2a7d5';
        const OLD_TOKEN_MARKETPLACE_SCID = '96f317d4e30e6329b6216fc5be5c3904429f79ff5b202405f8c382c950857b98';
        
        let scid = this.marketConfig.tokenMarketplaceScid;
        
        // Force update if old SCID or invalid
        if (!scid || scid.length !== 64 || scid === OLD_TOKEN_MARKETPLACE_SCID || scid !== NEW_TOKEN_MARKETPLACE_SCID) {
            scid = NEW_TOKEN_MARKETPLACE_SCID;
            this.marketConfig.tokenMarketplaceScid = scid;
            this.saveMarketplaceConfig && this.saveMarketplaceConfig();
        }
        
        return scid;
    };

    DeroNFTApp.prototype.getTokenMarketplaceScid = function() {
        if (!this.marketConfig) {
            this.marketConfig = this.loadMarketplaceConfig ? this.loadMarketplaceConfig() : { g45MarketplaceScid: '', nfaMarketScids: {}, tokenMarketplaceScid: '' };
        }
        // ALWAYS use the new token marketplace SCID - no old SCIDs allowed
        const NEW_TOKEN_MARKETPLACE_SCID = '890fa1ad517eeaf71035a3e69a4e2b4ca085efb82172e39e4f64990d81d2a7d5';
        const OLD_TOKEN_MARKETPLACE_SCID = '96f317d4e30e6329b6216fc5be5c3904429f79ff5b202405f8c382c950857b98';
        
        let scid = this.marketConfig.tokenMarketplaceScid;
        
        // Force update if old SCID or invalid
        if (!scid || scid.length !== 64 || scid === OLD_TOKEN_MARKETPLACE_SCID || scid !== NEW_TOKEN_MARKETPLACE_SCID) {
            scid = NEW_TOKEN_MARKETPLACE_SCID;
            this.marketConfig.tokenMarketplaceScid = scid;
            this.saveMarketplaceConfig && this.saveMarketplaceConfig();
        }
        
        return scid;
    };

    /* ------------------------------------------------------------------
     * Marketplace Configuration Functions
     * Moved from appfeat6.js to reduce file size
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.loadMarketplaceConfig = function() {
        const NEW_TOKEN_MARKETPLACE_SCID = '890fa1ad517eeaf71035a3e69a4e2b4ca085efb82172e39e4f64990d81d2a7d5';
        const NEW_G45_MARKETPLACE_SCID = 'e25c50680feb0b89eb6b640100fd92b49698c0e0c62681f0c3c5ee899d096aea';
        const OLD_TOKEN_MARKETPLACE_SCID = '96f317d4e30e6329b6216fc5be5c3904429f79ff5b202405f8c382c950857b98';
        
        try {
            const raw = localStorage.getItem('ored_market_config');
            if (raw) {
                const config = JSON.parse(raw);
                
                // Auto-update old SCIDs to new ones
                let updated = false;
                
                if (config.tokenMarketplaceScid === OLD_TOKEN_MARKETPLACE_SCID || 
                    (config.tokenMarketplaceScid && config.tokenMarketplaceScid !== NEW_TOKEN_MARKETPLACE_SCID && config.tokenMarketplaceScid.length === 64)) {
                    config.tokenMarketplaceScid = NEW_TOKEN_MARKETPLACE_SCID;
                    updated = true;
                } else if (!config.tokenMarketplaceScid) {
                    config.tokenMarketplaceScid = NEW_TOKEN_MARKETPLACE_SCID;
                    updated = true;
                }
                
                if (config.g45MarketplaceScid && config.g45MarketplaceScid !== NEW_G45_MARKETPLACE_SCID && config.g45MarketplaceScid.length === 64) {
                    config.g45MarketplaceScid = NEW_G45_MARKETPLACE_SCID;
                    updated = true;
                } else if (!config.g45MarketplaceScid) {
                    config.g45MarketplaceScid = NEW_G45_MARKETPLACE_SCID;
                    updated = true;
                }
                
                if (updated) {
                    localStorage.setItem('ored_market_config', JSON.stringify(config));
                }
                
                return config;
            }
        } catch (error) {
        }
        return {
            g45MarketplaceScid: NEW_G45_MARKETPLACE_SCID,
            nfaMarketScids: {},
            tokenMarketplaceScid: NEW_TOKEN_MARKETPLACE_SCID
        };
    };

    DeroNFTApp.prototype.saveMarketplaceConfig = function() {
        try {
            localStorage.setItem('ored_market_config', JSON.stringify(this.marketConfig || {}));
        } catch (error) {
        }
    };

    DeroNFTApp.prototype.ensureG45MarketplaceScid = function(promptUser = true) {
        if (!this.marketConfig) {
            this.marketConfig = this.loadMarketplaceConfig ? this.loadMarketplaceConfig() : { g45MarketplaceScid: '', nfaMarketScids: {} };
        }
        // ALWAYS use the new G45 marketplace SCID
        const NEW_G45_MARKETPLACE_SCID = 'e25c50680feb0b89eb6b640100fd92b49698c0e0c62681f0c3c5ee899d096aea';
        
        let scid = this.marketConfig.g45MarketplaceScid;
        
        // Force update if invalid or not the new SCID
        if (!scid || scid.length !== 64 || scid !== NEW_G45_MARKETPLACE_SCID) {
            scid = NEW_G45_MARKETPLACE_SCID;
            this.marketConfig.g45MarketplaceScid = scid;
            this.saveMarketplaceConfig && this.saveMarketplaceConfig();
        }
        
        return scid;
    };

    DeroNFTApp.prototype.getNfaMarketplaceScid = function(assetScid, promptUser = false) {
        if (!assetScid) return '';
        if (!this.marketConfig) {
            this.marketConfig = this.loadMarketplaceConfig ? this.loadMarketplaceConfig() : { g45MarketplaceScid: '', nfaMarketScids: {} };
        }
        if (!this.marketConfig.nfaMarketScids) {
            this.marketConfig.nfaMarketScids = {};
        }
        let scid = this.marketConfig.nfaMarketScids[assetScid];
        if ((!scid || scid.length !== 64) && promptUser) {
            const input = window.prompt('Enter the marketplace SCID for this NFA:', scid || '');
            if (input && input.trim().length === 64) {
                scid = input.trim();
                this.marketConfig.nfaMarketScids[assetScid] = scid;
                this.saveMarketplaceConfig && this.saveMarketplaceConfig();
            }
        }
        return scid;
    };

    DeroNFTApp.prototype.setNfaMarketplaceScid = function(assetScid, marketScid) {
        if (!assetScid || !marketScid) return;
        if (!this.marketConfig) {
            this.marketConfig = this.loadMarketplaceConfig ? this.loadMarketplaceConfig() : { g45MarketplaceScid: '', nfaMarketScids: {} };
        }
        if (!this.marketConfig.nfaMarketScids) {
            this.marketConfig.nfaMarketScids = {};
        }
        this.marketConfig.nfaMarketScids[assetScid] = marketScid;
        this.saveMarketplaceConfig && this.saveMarketplaceConfig();
    };

    DeroNFTApp.prototype.setTokenMarketplaceScid = function(marketScid) {
        if (!marketScid || marketScid.length !== 64) return;
        if (!this.marketConfig) {
            this.marketConfig = this.loadMarketplaceConfig ? this.loadMarketplaceConfig() : { g45MarketplaceScid: '', nfaMarketScids: {}, tokenMarketplaceScid: '' };
        }
        this.marketConfig.tokenMarketplaceScid = marketScid;
        this.saveMarketplaceConfig && this.saveMarketplaceConfig();
    };

    /* ------------------------------------------------------------------
     * Collection Modal Functions
     * Moved from appfeat6.js to reduce file size
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.showCollectionModal = function(scid, nfts, collectionName = '') {
        console.log(`📋 [showCollectionModal] Showing collection modal:`, {
            scid: scid,
            collectionName: collectionName,
            nftCount: nfts ? nfts.length : 0,
            nfts: nfts ? nfts.slice(0, 3).map(n => ({ id: n.id, name: n.name, scid: n.scid })) : []
        });
        
        if (!Array.isArray(nfts) || nfts.length === 0) {
            console.warn(`⚠️ [showCollectionModal] No NFTs to display (array: ${Array.isArray(nfts)}, length: ${nfts ? nfts.length : 'null'})`);
            this.showNotification('No NFTs found in this collection. The collection might be empty or the query failed. Check the browser console for details.', 'info');
            return;
        }

        if (!this.renderAssetCard) {
            console.error('❌ [showCollectionModal] renderAssetCard function not available!');
            this.showError('Error: renderAssetCard function not available');
            return;
        }

        let cardsHtml = '';
        try {
            cardsHtml = nfts.map((nft, index) => {
                try {
                    return this.renderAssetCard(nft, index, 'collection');
                } catch (cardError) {
                    console.error(`❌ [showCollectionModal] Error rendering card ${index}:`, cardError, nft);
                    return ''; // Skip cards that fail to render
                }
            }).filter(html => html).join('');
            
            if (!cardsHtml || cardsHtml.trim().length === 0) {
                console.error('❌ [showCollectionModal] No cards were rendered successfully!');
                this.showError('Error: Failed to render NFT cards. Check console for details.');
                return;
            }
        } catch (renderError) {
            console.error('❌ [showCollectionModal] Error rendering cards:', renderError);
            this.showError(`Error rendering NFT cards: ${renderError.message}`);
            return;
        }

        const modalHtml = `
            <div class="modal active" id="collectionModal" onclick="if(event.target.id === 'collectionModal') app.hideCollectionModal()">
                <div class="modal-content" style="max-width: 90%; max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">${collectionName || 'Collection'} NFTs</h2>
                        <button class="btn btn-secondary" onclick="app.hideCollectionModal()" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                    <div style="margin-bottom: 15px; color: #ccc;">
                        <p style="margin: 0;"><strong>SCID:</strong> ${scid}</p>
                        <p style="margin: 0;"><strong>Total NFTs:</strong> ${nfts.length}</p>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px;">
                        ${cardsHtml}
                    </div>
                </div>
            </div>
        `;
        const existingModal = document.getElementById('collectionModal');
        if (existingModal) {
            existingModal.remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    DeroNFTApp.prototype.hideCollectionModal = function() {
        const modal = document.getElementById('collectionModal');
        if (modal) {
            modal.remove();
        }
    };

    /* ------------------------------------------------------------------
     * Asset Selection Modal for Create Order Buttons
     * Moved from appfeat3.js to reduce file size
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.showAssetSelectionModal = function(orderType) {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
        return;
    };

    DeroNFTApp.prototype.hideAssetSelectionModal = function() {
        const modal = document.getElementById('assetSelectionModal');
        if (modal) {
            modal.remove();
        }
    };

    DeroNFTApp.prototype.selectAssetForOrder = function(scid, tokenId, assetName, orderType) {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
        return;
    };

    /* ------------------------------------------------------------------
     * Simple-Gnomon Integration
     * Scans simple-gnomon indexer for all owned NFT/NFA assets
     * Moved from appfeat4.js to reduce file size
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.scanGnomonForAssets = async function() {
        if (!this.currentAddress) {
            this.showError('Please connect your wallet first');
            return;
        }

        if (!this.deroWallet || !this.deroWallet.ws) {
            this.showError('Wallet connection unavailable');
            return;
        }

        // Simple-gnomon default endpoint
        const gnomonApiUrl = 'http://127.0.0.1:8082';
        
        // Update loading element with progress
        const loadingEl = document.getElementById('loadingAssets');
        const updateProgress = (label, processed = 0, total = 0) => {
            if (loadingEl) {
                loadingEl.innerHTML = `
                    <i class="fas fa-spinner fa-spin"></i> ${label}${total > 0 ? ` (${processed}/${total})` : ''}
                `;
                loadingEl.classList.remove('hidden');
            }
        };
        
        this.showLoading('loadingAssets');
        updateProgress('Connecting to simple-gnomon...');

        try {
            // Step 1: Check if simple-gnomon is running
            let indexedScids = [];
            try {
                const response = await fetch(`${gnomonApiUrl}/api/indexedscs`);
                if (!response.ok) {
                    throw new Error(`simple-gnomon not responding: ${response.status}`);
                }
                const data = await response.json();
                indexedScids = data.indexedscs || [];
        
                if (!Array.isArray(indexedScids) || indexedScids.length === 0) {
                    this.showError('simple-gnomon returned no indexed SCIDs. Make sure simple-gnomon is running and has indexed the blockchain.');
                    return;
                }
            } catch (error) {
                this.showError(`Failed to connect to simple-gnomon at ${gnomonApiUrl}. Make sure simple-gnomon is running locally. Error: ${error.message}`);
                return;
            }

            updateProgress(`Found ${indexedScids.length} indexed SCIDs. Checking ownership...`, 0, indexedScids.length);

            // Step 2: Check ownership for each SCID (batch process)
            const ownedScids = [];
            const batchSize = 10; // Process 10 SCIDs at a time to avoid overwhelming wallet
            const totalBatches = Math.ceil(indexedScids.length / batchSize);

            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const batch = indexedScids.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
                
                // Process batch in parallel
                const batchPromises = batch.map(async (scid) => {
                    if (!scid || scid.length !== 64 || !/^[0-9a-fA-F]+$/i.test(scid)) {
                        return null;
                    }

                    try {
                        // Check ownership using GetBalance with SCID
                        const balance = await this.deroWallet.getBalance(null, scid.toLowerCase());
                        
                        // NFT: balance >= 100000, NFA: balance >= 1
                        if (balance >= 1) {
                            return scid.toLowerCase();
                        }
                    } catch (error) {
                        // Ignore errors for individual SCIDs (might not be assets)
                        return null;
                    }
                    return null;
                });

                const batchResults = await Promise.all(batchPromises);
                const batchOwned = batchResults.filter(scid => scid !== null);
                ownedScids.push(...batchOwned);

                // Update progress
                const processed = Math.min((batchIndex + 1) * batchSize, indexedScids.length);
                updateProgress(`Checking ownership... Found ${ownedScids.length} owned assets`, processed, indexedScids.length);
                
                // Small delay between batches to avoid overwhelming wallet
                if (batchIndex < totalBatches - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            if (ownedScids.length === 0) {
                this.showNotification('No owned assets found in simple-gnomon index.', 'info');
            return;
        }

            updateProgress(`Querying metadata for ${ownedScids.length} owned assets...`, 0, ownedScids.length);

            // Step 3: Query metadata for owned SCIDs
            const assetsToAdd = [];
            const existingIds = new Set((this.savedAssets || []).map(a => (a.id || '').toLowerCase()));

            for (let i = 0; i < ownedScids.length; i++) {
                const scid = ownedScids[i];
                
                // Skip if already in saved assets
                if (existingIds.has(scid)) {
                    continue;
                }

                try {
                    // Query asset metadata
                    const assetData = await this.queryAssetBySCID ? await this.queryAssetBySCID(scid, { forceRefresh: true }) : null;
                    
                    if (assetData && !assetData.error) {
                        // Mark as owned
                        assetData.owned = true;
                        assetData.ownershipStatus = 'owned';
                        assetData.addedAt = new Date().toISOString();
                        
                        // Classify asset type
                        if (this.classifyAssetType) {
                            assetData.type = this.classifyAssetType(assetData.contractType, assetData.type, assetData.isCollection);
                        }
                        
                        assetsToAdd.push(assetData);
                    } else {
                        // Even if metadata query fails, add basic asset info
                        const basicAsset = {
                            id: scid,
                            scid: scid,
                            name: `Asset ${scid.substring(0, 8)}...`,
                            type: 'NFT',
                            owned: true,
                            ownershipStatus: 'owned',
                            addedAt: new Date().toISOString(),
                            image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                            description: 'Found via simple-gnomon scan'
                        };
                        assetsToAdd.push(basicAsset);
                    }
                } catch (error) {
                    // On error, still add basic asset info
                    const basicAsset = {
                        id: scid,
                        scid: scid,
                        name: `Asset ${scid.substring(0, 8)}...`,
                        type: 'NFT',
                        owned: true,
                        ownershipStatus: 'owned',
                        addedAt: new Date().toISOString(),
                        image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                        description: 'Found via simple-gnomon scan'
                    };
                    assetsToAdd.push(basicAsset);
                }

                // Update progress
                if ((i + 1) % 10 === 0 || i === ownedScids.length - 1) {
                    updateProgress(`Querying metadata...`, i + 1, ownedScids.length);
                }

                // Small delay to avoid overwhelming wallet
                if (i < ownedScids.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            // Step 4: Save assets to cache
            if (assetsToAdd.length > 0) {
                // Add to savedAssets
                if (!Array.isArray(this.savedAssets)) {
                    this.savedAssets = [];
                }
                this.savedAssets.push(...assetsToAdd);
                
                // Remove duplicates
                const uniqueAssets = [...new Map(this.savedAssets.map(a => [a.id?.toLowerCase() || a.scid?.toLowerCase(), a])).values()];
                this.savedAssets = uniqueAssets;
                
                // Save to localStorage
                this.saveAssets();
                
                // Update cache
                this.primeCachedAssetsFromSaved(false);
                
                // Refresh display
                if (this.renderAssetsWithOrders) {
                    this.renderAssetsWithOrders(this.assetsCache.value);
                }
                
                this.showSuccess(`✅ Found and saved ${assetsToAdd.length} owned asset(s) from simple-gnomon!`);
        } else {
                this.showNotification('All found assets are already in your wallet view.', 'info');
            }

        } catch (error) {
            console.error('Simple-gnomon scan error:', error);
            this.showError(`Failed to scan simple-gnomon: ${error.message}`);
        } finally {
            this.hideLoading('loadingAssets');
        }
    };

}

// Initialize savedTokens after appfeat7.js loads and app is initialized
if (typeof window !== 'undefined') {
    // Wait for app to be initialized
    setTimeout(() => {
        if (window.app && typeof window.app.loadSavedTokens === 'function') {
            if (!window.app.savedTokens || !Array.isArray(window.app.savedTokens)) {
                window.app.savedTokens = window.app.loadSavedTokens();
        }
        }
    }, 100);
}

// Wallet Calls Test Functions - Transaction History
// Moved from appfeat6.js to reduce file size

// Test Get Transaction History
async function testGetTransactionHistory() {
    if (!window.checkWalletConnection || !window.checkWalletConnection()) return;
    
    try {
        const filterScid = document.getElementById('txHistoryScid').value.trim() || null;
        
        if (!filterScid || filterScid.length !== 64) {
            alert('Please enter a valid SCID (64 hex characters) to query transaction history from contract state.');
            return;
        }
        
        if (window.logEngramResponse) {
            window.logEngramResponse({ method: 'Get Transaction History (from Contract State)', params: { filterScid }, status: 'querying contract state...' });
        }
        
        // Use DERO.GetSC to get contract state and extract transaction-related data
        const scResult = await window.app.deroWallet.ws.getSC(filterScid);
        const scData = scResult?.result || scResult;
        const stringKeys = scData?.stringkeys || {};
        const uint64Keys = scData?.uint64keys || {};
        
        // Extract transaction history from contract state
        // Different contract types store transaction data differently:
        // 1. G45 Marketplace: listing_* keys with seller, buyer, txid references
        // 2. Token Marketplace: buy_order_*, sell_order_* keys
        // 3. NFA (ART-NFA-MS1): owner changes, listing data
        
        const publicTransactions = [];
        
        // Helper to decode keys
        const decS = (key) => {
            const raw = stringKeys[key];
            if (!raw) return '';
            return window.app.decodeHexString ? window.app.decodeHexString(raw) : raw;
        };
        const decU = (key) => {
            if (uint64Keys[key] !== undefined) {
                const v = parseInt(uint64Keys[key], 10);
                return Number.isNaN(v) ? 0 : v;
            }
            const raw = stringKeys[key];
            if (!raw) return 0;
            const d = window.app.decodeHexString ? window.app.decodeHexString(raw) : raw;
            const p = parseInt(d, 10);
            if (!Number.isNaN(p)) return p;
            const h = parseInt(raw, 16);
            return Number.isNaN(h) ? 0 : h;
        };
        
        // Check for G45 Marketplace listings
        const listingCount = decU('listingCounter');
        for (let id = 1; id <= listingCount; id++) {
            const status = decU(`listing_${id}_status`);
            const seller = decS(`listing_${id}_seller`);
            const buyer = decS(`listing_${id}_buyer`);
            const assetScid = decS(`listing_${id}_asset`);
            const price = decU(`listing_${id}_price`);
            const createdHeight = decU(`listing_${id}_created`);
            const filledHeight = decU(`listing_${id}_filled`);
            
            if (seller || buyer) {
                publicTransactions.push({
                    type: status === 0 ? 'active_listing' : status === 1 ? 'filled' : 'cancelled',
                    entrypoint: 'List',
                    seller: seller,
                    buyer: buyer || null,
                    assetScid: assetScid,
                    price: price,
                    createdHeight: createdHeight,
                    filledHeight: filledHeight || null,
                    listingId: id,
                    note: 'G45 Marketplace listing'
                });
            }
        }
        
        // Check for Token Marketplace orders
        const buyOrderCount = decU('buyOrderCounter');
        for (let id = 1; id <= buyOrderCount; id++) {
            const buyer = decS(`buy_order_${id}_buyer`);
            const tokenScid = decS(`buy_order_token_${id}`);
            const price = decU(`buy_order_price_${id}`);
            const amount = decU(`buy_order_amount_${id}`);
            const status = decU(`buy_order_${id}_status`);
            
            if (buyer) {
                publicTransactions.push({
                    type: status === 0 ? 'active_buy_order' : status === 1 ? 'filled' : 'cancelled',
                    entrypoint: 'CreateBuyOrder',
                    buyer: buyer,
                    tokenScid: tokenScid,
                    price: price,
                    amount: amount,
                    orderId: id,
                    note: 'Token Marketplace buy order'
                });
            }
        }
        
        const sellOrderCount = decU('sellOrderCounter');
        for (let id = 1; id <= sellOrderCount; id++) {
            const seller = decS(`sell_order_${id}_seller`);
            const tokenScid = decS(`sell_order_token_${id}`);
            const price = decU(`sell_order_price_${id}`);
            const amount = decU(`sell_order_amount_${id}`);
            const status = decU(`sell_order_${id}_status`);
            
            if (seller) {
                publicTransactions.push({
                    type: status === 0 ? 'active_sell_order' : status === 1 ? 'filled' : 'cancelled',
                    entrypoint: 'CreateSellOrder',
                    seller: seller,
                    tokenScid: tokenScid,
                    price: price,
                    amount: amount,
                    orderId: id,
                    note: 'Token Marketplace sell order'
                });
            }
        }
        
        // Check for NFA (ART-NFA-MS1) listing data
        const nfaOwner = decS('owner');
        const nfaActive = decU('active');
        const nfaListType = decS('listType');
        const nfaStartPrice = decU('startPrice');
        const nfaStartBlockTime = decU('startBlockTime');
        
        if (nfaOwner && (nfaActive === 1 || nfaListType === 'sale' || nfaListType === 'auction')) {
            publicTransactions.push({
                type: nfaActive === 1 ? 'active_listing' : 'inactive_listing',
                entrypoint: 'Start',
                seller: nfaOwner,
                assetScid: filterScid,
                price: nfaStartPrice,
                listType: nfaListType,
                startBlockTime: nfaStartBlockTime,
                note: 'NFA (ART-NFA-MS1) listing'
            });
        }
        
        // Check for displayed NFT data (owner_ keys)
        const currentAddress = window.app.currentAddress || '';
        for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
            const keyLower = rawKey.toLowerCase();
            if (keyLower.startsWith('owner_')) {
                const ownerAddr = rawKey.substring(6);
                let amount = 0;
                if (uint64Keys[rawKey] !== undefined) {
                    amount = parseInt(uint64Keys[rawKey], 10) || 0;
                } else if (rawValue) {
                    amount = parseInt(rawValue, 10) || parseInt(rawValue, 16) || 0;
                }
                if (amount >= 100000) {
                    publicTransactions.push({
                        type: 'displayed',
                        entrypoint: 'DisplayToken',
                        owner: ownerAddr,
                        assetScid: filterScid,
                        amount: amount,
                        note: 'G45 NFT displayed (owner_ key)'
                    });
                }
            }
        }
        
        if (window.logEngramResponse) {
            window.logEngramResponse({
                method: 'Get Transaction History (from Contract State)',
                params: { filterScid },
                contractState: {
                    totalStringKeys: Object.keys(stringKeys).length,
                    totalUint64Keys: Object.keys(uint64Keys).length
                },
                publicTransactions: publicTransactions,
                summary: {
                    totalFound: publicTransactions.length,
                    activeListings: publicTransactions.filter(tx => tx.type.includes('active')).length,
                    filledOrders: publicTransactions.filter(tx => tx.type === 'filled').length,
                    displayedNFTs: publicTransactions.filter(tx => tx.type === 'displayed').length,
                    note: `Found ${publicTransactions.length} public transaction(s) in contract state. Note: This shows on-chain state data, not full transaction history. For complete transaction history including txids, use a blockchain explorer.`
                }
            });
        }
    } catch (error) {
        if (window.logEngramResponse) {
            window.logEngramResponse({ 
                method: 'Get Transaction History (from Contract State)', 
                error: error.message || error,
                stack: error.stack 
            });
        }
    }
}

// Expose globally
if (typeof window !== 'undefined') {
    window.testGetTransactionHistory = testGetTransactionHistory;
}

