if (typeof DeroNFTApp !== 'undefined') {
    const ORDER_TYPES = {
        SELL: 'sell',
        BUY: 'buy'
    };

    const ORDER_STATUS = {
        ACTIVE: 'active',
        DRAFT: 'draft',
        CANCELLED: 'cancelled'
    };

    DeroNFTApp.prototype.getOrderStorageKey = function(type) {
        const address = (this.currentAddress || 'anonymous').toLowerCase();
        return `ored_${type}_orders_${address}`;
    };

    DeroNFTApp.prototype.getLocalOrders = function(type) {
        try {
            const raw = localStorage.getItem(this.getOrderStorageKey(type));
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    };

    DeroNFTApp.prototype.saveLocalOrders = function(type, orders) {
        try {
            localStorage.setItem(this.getOrderStorageKey(type), JSON.stringify(orders || []));
        } catch (error) {
            // Ignore save errors
        }
    };

    DeroNFTApp.prototype.buildSavedAssetIndex = function() {
        const index = {};
        const assets = Array.isArray(this.savedAssets) ? this.savedAssets : [];
        assets.forEach(asset => {
            if (!asset || !asset.scid) return;
            const key = asset.scid.toLowerCase();
            if (!index[key]) {
                index[key] = {
                    scid: asset.scid,
                    entries: []
                };
            }
            index[key].entries.push(asset);
        });
        return index;
    };

    DeroNFTApp.prototype.getTrackedAssetScids = function() {
        const tracked = new Set();
        const addFromList = (list) => {
            if (!Array.isArray(list)) return;
            list.forEach(asset => {
                if (asset && asset.scid) {
                    tracked.add(asset.scid.toLowerCase());
                }
            });
        };
        addFromList(this.savedAssets);
        const cache = this.assetsCache?.value;
        if (Array.isArray(cache)) {
            addFromList(cache);
        } else if (cache) {
            addFromList(cache.nfts);
            addFromList(cache.nfas);
        }
        addFromList(this.lastSearchResults);
        addFromList(this.lastCollectionResults);
        return tracked;
    };

    DeroNFTApp.prototype.fetchOnChainSellOrders = async function() {
        if (!this.deroWallet || !this.deroWallet.ws || !this.deroWallet.ws.getSC) {
            return [];
        }
        const orders = [];
        try {
            const g45 = await this.fetchG45SellOrders();
            orders.push(...g45);
        } catch (e) {
            // Ignore fetch errors
        }
        // ART-NFA-MS1: each NFA contract is its own market. Scan known NFA SCIDs.
        try {
            const art = await this.fetchArtificerSellOrdersMS1();
            orders.push(...art);
        } catch (e) {
            // Ignore fetch errors
        }
        return orders;
    };

    DeroNFTApp.prototype.fetchOnChainBuyOrders = async function() {
        if (!this.deroWallet || !this.deroWallet.ws || !this.deroWallet.ws.getSC) {
            return [];
        }
        try {
            return await this.fetchG45BuyOrders();
        } catch (e) {
            // Ignore fetch errors
            return [];
        }
    };

    // Discover ART-NFA-MS1 active sales/auctions by querying known NFA SCIDs
    DeroNFTApp.prototype.fetchArtificerSellOrdersMS1 = async function() {
        const results = [];
        const seen = new Set();
        const collectCandidates = () => {
            const out = [];
            const add = (list) => {
                if (Array.isArray(list)) out.push(...list);
            };
            add(this.savedAssets);
            const cache = this.assetsCache?.value;
            if (Array.isArray(cache)) add(cache);
            if (cache?.nfts) add(cache.nfts);
            add(this.lastSearchResults);
            add(this.lastCollectionResults);
            return out;
        };
        const candidates = collectCandidates().filter(a => a && this.isArtificerAsset && this.isArtificerAsset(a) && a.scid);
        for (const asset of candidates) {
            const scid = asset.scid;
            if (seen.has(scid)) continue;
            seen.add(scid);
            try {
                const sc = await this.deroWallet.ws.getSC(scid);
                const data = sc?.result || {};
                const stringKeys = data.stringkeys || {};
                const uint64Keys = data.uint64keys || {};
                const decStr = (k) => {
                    const raw = stringKeys[k];
                    if (!raw) return '';
                    return this.decodeHexString ? this.decodeHexString(raw) : raw;
                };
                const decU = (k) => {
                    if (uint64Keys[k] !== undefined) {
                        const v = parseInt(uint64Keys[k], 10);
                        return Number.isNaN(v) ? 0 : v;
                    }
                    const raw = stringKeys[k];
                    if (!raw) return 0;
                    const d = this.decodeHexString ? this.decodeHexString(raw) : raw;
                    const p = parseInt(d, 10);
                    if (!Number.isNaN(p)) return p;
                    const h = parseInt(raw, 16);
                    return Number.isNaN(h) ? 0 : h;
                };
                const active = decU('active');
                const listType = decStr('listType');
                const scBalance = decU('scBalance');
                const startPrice = decU('startPrice');
                
                // Include listings that are:
                // 1. Active (active === 1, scBalance === 1, listType is sale/auction)
                // 2. OR pending (scBalance > 0 and listType is sale/auction) - transaction confirmed but listing not fully active yet
                // 3. OR has listing data (listType is sale/auction) - might be pending confirmation
                const isActiveListing = active === 1 && scBalance === 1 && (listType === 'sale' || listType === 'auction');
                const isPendingListing = scBalance > 0 && (listType === 'sale' || listType === 'auction');
                const hasListingData = (listType === 'sale' || listType === 'auction');
                
                if (isActiveListing || isPendingListing || hasListingData) {
                    const orderStatus = isActiveListing ? 'active' : 'pending';
                    results.push({
                        id: `art_${scid}_${Date.now()}`,
                        type: 'sell',
                        status: orderStatus,
                        scid,
                        tokenId: '',
                        asset: asset.name || `NFA ${scid.substring(0, 8)}...`,
                        price: this.atomicToDero ? this.atomicToDero(startPrice) : (startPrice / 100000),
                        marketplace: 'ART-NFA-MS1',
                        marketplaceScid: scid,
                        seller: '', // not public
                        createdAt: Date.now(),
                        expiresAt: 0,
                        collection: asset.collection_name || asset.collection || '',
                        image: asset.image || (this.getPlaceholderImage ? this.getPlaceholderImage() : ''),
                        fromOnChain: true,
                        active: active,
                        scBalance: scBalance,
                        listType: listType
                    });
                }
            } catch (e) {
                // skip bad SCIDs silently
            }
        }
        return results;
    };

    // G45 marketplace: enumerate active sell listings (status==0)
    DeroNFTApp.prototype.fetchG45SellOrders = async function() {
        const marketScid = this.ensureG45MarketplaceScid && this.ensureG45MarketplaceScid(false);
        if (!marketScid || !this.deroWallet?.ws?.getSC) return [];
        const trackedScids = this.getTrackedAssetScids ? this.getTrackedAssetScids() : new Set();
        if (!trackedScids || trackedScids.size === 0) {
            return [];
        }
        try {
            const sc = await this.deroWallet.ws.getSC(marketScid);
            const data = sc?.result || {};
            const stringKeys = data.stringkeys || {};
            const uint64Keys = data.uint64keys || {};
            const decStr = (k) => {
                const raw = stringKeys[k];
                if (!raw) return '';
                return this.decodeHexString ? this.decodeHexString(raw) : raw;
            };
            const decU = (k) => {
                if (uint64Keys[k] !== undefined) {
                    const v = parseInt(uint64Keys[k], 10);
                    return Number.isNaN(v) ? 0 : v;
                }
                const raw = stringKeys[k];
                if (!raw) return 0;
                const d = this.decodeHexString ? this.decodeHexString(raw) : raw;
                const p = parseInt(d, 10);
                if (!Number.isNaN(p)) return p;
                const h = parseInt(raw, 16);
                return Number.isNaN(h) ? 0 : h;
            };
            const listingCount = decU('listingCounter');
            const out = [];
            for (let id = 1; id <= listingCount; id++) {
                const status = decU(`listing_${id}_status`);
                if (status !== 0) continue;
                const assetScid = decStr(`listing_${id}_asset`);
                if (!assetScid || !trackedScids.has(assetScid.toLowerCase())) continue;
                const token = decU(`listing_${id}_token`);
                const seller = decStr(`listing_${id}_seller`);
                const priceAtomic = decU(`listing_${id}_price`);
                const expireTs = decU(`listing_${id}_expire`);
                const price = this.atomicToDero ? this.atomicToDero(priceAtomic) : priceAtomic / 100000;
                out.push({
                    id: `g45_listing_${id}`,
                    type: 'sell',
                    status: 'active',
                    scid: assetScid,
                    tokenId: token || '',
                    asset: `NFT ${assetScid.substring(0, 8)}...`,
                    price,
                    marketplace: 'G45 Marketplace',
                    marketplaceScid: marketScid,
                    seller,
                    createdAt: Date.now(),
                    expiresAt: expireTs ? expireTs * 1000 : 0,
                    image: this.findAssetByScid?.(assetScid)?.image || this.getPlaceholderImage?.(),
                    fromOnChain: true
                });
            }
            return out;
        } catch (e) {
            return [];
        }
    };

    DeroNFTApp.prototype.fetchG45BuyOrders = async function() {
        const marketScid = this.ensureG45MarketplaceScid && this.ensureG45MarketplaceScid(false);
        if (!marketScid || !this.deroWallet?.ws?.getSC) return [];
        const trackedScids = this.getTrackedAssetScids ? this.getTrackedAssetScids() : new Set();
        if (!trackedScids || trackedScids.size === 0) {
            return [];
        }
        try {
            const sc = await this.deroWallet.ws.getSC(marketScid);
            const data = sc?.result || {};
            const stringKeys = data.stringkeys || {};
            const uint64Keys = data.uint64keys || {};
            const decStr = (k) => {
                const raw = stringKeys[k];
                if (!raw) return '';
                return this.decodeHexString ? this.decodeHexString(raw) : raw;
            };
            const decU = (k) => {
                if (uint64Keys[k] !== undefined) {
                    const v = parseInt(uint64Keys[k], 10);
                    return Number.isNaN(v) ? 0 : v;
                }
                const raw = stringKeys[k];
                if (!raw) return 0;
                const d = this.decodeHexString ? this.decodeHexString(raw) : raw;
                const p = parseInt(d, 10);
                if (!Number.isNaN(p)) return p;
                const h = parseInt(raw, 16);
                return Number.isNaN(h) ? 0 : h;
            };
            const buyCount = decU('buyCounter');
            const out = [];
            for (let id = 1; id <= buyCount; id++) {
                const status = decU(`buy_${id}_status`);
                if (status !== 0) continue;
                const assetScid = decStr(`buy_${id}_asset`);
                if (!assetScid || !trackedScids.has(assetScid.toLowerCase())) continue;
                const token = decU(`buy_${id}_token`);
                const buyer = decStr(`buy_${id}_buyer`);
                const priceAtomic = decU(`buy_${id}_price`);
                const expireTs = decU(`buy_${id}_expire`);
                const price = this.atomicToDero ? this.atomicToDero(priceAtomic) : priceAtomic / 100000;
                out.push({
                    id: `g45_buy_${id}`,
                    type: 'buy',
                    status: 'active',
                    scid: assetScid,
                    tokenId: token || '',
                    asset: `NFT ${assetScid.substring(0, 8)}...`,
                    price,
                    marketplace: 'G45 Marketplace',
                    marketplaceScid: marketScid,
                    buyer,
                    createdAt: Date.now(),
                    expiresAt: expireTs ? expireTs * 1000 : 0,
                    image: this.findAssetByScid?.(assetScid)?.image || this.getPlaceholderImage?.(),
                    fromOnChain: true
                });
            }
            return out;
        } catch (e) {
            return [];
        }
    };

    /* ------------------------------------------------------------------
     * Loaders
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.loadSellOrders = async function(forceRefresh = false) {
        // Load saved orders first to show immediately
        const savedOrders = this.getLocalOrders('sell');
        if (savedOrders && savedOrders.length > 0 && !forceRefresh) {
            this.renderSellOrders(savedOrders);
            if (typeof this.populateCollectionFilters === 'function') {
                this.populateCollectionFilters(savedOrders, 'sell');
            }
        }

        // If not forcing refresh and we have saved orders, just show them
        if (!forceRefresh && savedOrders && savedOrders.length > 0) {
            return;
        }

        // Check if already refreshing
        if (this.refreshInProgress && this.refreshInProgress.sell) {
            this.showNotification('Refresh already in progress...', 'info');
            return;
        }

        if (!this.refreshInProgress) {
            this.refreshInProgress = {};
        }
        this.refreshInProgress.sell = true;

        const progressContainer = document.getElementById('sellOrdersList');
        let progressBar = document.getElementById('refreshProgressSell');
        let cancelBtn = document.getElementById('cancelRefreshSell');

        // Create progress UI if it doesn't exist
        if (!progressBar && progressContainer) {
            const progressWrapper = document.createElement('div');
            progressWrapper.id = 'refreshProgressWrapperSell';
            progressWrapper.style.cssText = 'padding: 20px; text-align: center; background: #2a2a2a; border-radius: 8px; margin: 10px 0;';
            
            progressBar = document.createElement('div');
            progressBar.id = 'refreshProgressSell';
            progressBar.style.cssText = 'width: 100%; height: 20px; background: #1a1a1a; border-radius: 10px; overflow: hidden; margin: 10px 0;';
            
            const progressFill = document.createElement('div');
            progressFill.id = 'refreshProgressFillSell';
            progressFill.style.cssText = 'height: 100%; background: linear-gradient(90deg, #4a9eff, #0066cc); width: 0%; transition: width 0.3s;';
            progressBar.appendChild(progressFill);
            
            const progressText = document.createElement('div');
            progressText.id = 'refreshProgressTextSell';
            progressText.style.cssText = 'color: #fff; margin: 10px 0;';
            progressText.textContent = 'Scanning on-chain orders... 0%';
            
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelRefreshSell';
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => {
                if (this.refreshInProgress) {
                    this.refreshInProgress.sell = false;
                }
                if (progressWrapper.parentNode) {
                    progressWrapper.parentNode.removeChild(progressWrapper);
                }
                this.hideLoading('loadingSellOrders');
            };
            
            progressWrapper.appendChild(progressText);
            progressWrapper.appendChild(progressBar);
            progressWrapper.appendChild(cancelBtn);
            progressContainer.insertBefore(progressWrapper, progressContainer.firstChild);
        }

        this.showLoading('loadingSellOrders');
        
        try {
            const trackedScids = this.getTrackedAssetScids ? this.getTrackedAssetScids() : new Set();
            const totalAssets = trackedScids.size;
            let processed = 0;

            const progressTextEl = document.getElementById('refreshProgressTextSell');
            const progressFillEl = document.getElementById('refreshProgressFillSell');

            const updateProgress = () => {
                if (progressTextEl) {
                    const percent = totalAssets > 0 ? Math.floor((processed / totalAssets) * 100) : 0;
                    progressTextEl.textContent = `Scanning on-chain orders... ${percent}% (${processed}/${totalAssets} assets)`;
                    if (progressFillEl) {
                        progressFillEl.style.width = `${percent}%`;
                    }
                }
            };

            updateProgress();

            // Fetch orders from all marketplaces
            const onChain = await this.fetchOnChainSellOrders();
            processed = totalAssets;
            updateProgress();

            // Check if refresh was cancelled
            if (!this.refreshInProgress || !this.refreshInProgress.sell) {
                return;
            }

            // Save orders to local storage for persistence
            this.saveLocalOrders('sell', onChain);
            
            this.renderSellOrders(onChain);
            if (typeof this.populateCollectionFilters === 'function') {
                this.populateCollectionFilters(onChain, 'sell');
            }

            // Remove progress UI
            const progressWrapper = document.getElementById('refreshProgressWrapperSell');
            if (progressWrapper && progressWrapper.parentNode) {
                progressWrapper.parentNode.removeChild(progressWrapper);
            }
        } catch (error) {
            this.showError(`Failed to load sell orders: ${error.message}`);
            this.renderSellOrders([]);
            
            // Remove progress UI on error
            const progressWrapper = document.getElementById('refreshProgressWrapperSell');
            if (progressWrapper && progressWrapper.parentNode) {
                progressWrapper.parentNode.removeChild(progressWrapper);
            }
        } finally {
            if (this.refreshInProgress) {
                this.refreshInProgress.sell = false;
            }
            this.hideLoading('loadingSellOrders');
        }
    };

    DeroNFTApp.prototype.loadBuyOrders = async function(forceRefresh = false) {
        // Load saved orders first to show immediately
        const savedOrders = this.getLocalOrders('buy');
        if (savedOrders && savedOrders.length > 0 && !forceRefresh) {
            this.renderBuyOrders(savedOrders);
            if (typeof this.populateCollectionFilters === 'function') {
                this.populateCollectionFilters(savedOrders, 'buy');
            }
        }

        // If not forcing refresh and we have saved orders, just show them
        if (!forceRefresh && savedOrders && savedOrders.length > 0) {
            return;
        }

        // Check if already refreshing
        if (this.refreshInProgress && this.refreshInProgress.buy) {
            this.showNotification('Refresh already in progress...', 'info');
            return;
        }

        if (!this.refreshInProgress) {
            this.refreshInProgress = {};
        }
        this.refreshInProgress.buy = true;

        const progressContainer = document.getElementById('buyOrdersList');
        let progressBar = document.getElementById('refreshProgressBuy');
        let cancelBtn = document.getElementById('cancelRefreshBuy');

        // Create progress UI if it doesn't exist
        if (!progressBar && progressContainer) {
            const progressWrapper = document.createElement('div');
            progressWrapper.id = 'refreshProgressWrapperBuy';
            progressWrapper.style.cssText = 'padding: 20px; text-align: center; background: #2a2a2a; border-radius: 8px; margin: 10px 0;';
            
            progressBar = document.createElement('div');
            progressBar.id = 'refreshProgressBuy';
            progressBar.style.cssText = 'width: 100%; height: 20px; background: #1a1a1a; border-radius: 10px; overflow: hidden; margin: 10px 0;';
            
            const progressFill = document.createElement('div');
            progressFill.id = 'refreshProgressFillBuy';
            progressFill.style.cssText = 'height: 100%; background: linear-gradient(90deg, #4a9eff, #0066cc); width: 0%; transition: width 0.3s;';
            progressBar.appendChild(progressFill);
            
            const progressText = document.createElement('div');
            progressText.id = 'refreshProgressTextBuy';
            progressText.style.cssText = 'color: #fff; margin: 10px 0;';
            progressText.textContent = 'Scanning on-chain orders... 0%';
            
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelRefreshBuy';
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => {
                if (this.refreshInProgress) {
                    this.refreshInProgress.buy = false;
                }
                if (progressWrapper.parentNode) {
                    progressWrapper.parentNode.removeChild(progressWrapper);
                }
                this.hideLoading('loadingBuyOrders');
            };
            
            progressWrapper.appendChild(progressText);
            progressWrapper.appendChild(progressBar);
            progressWrapper.appendChild(cancelBtn);
            progressContainer.insertBefore(progressWrapper, progressContainer.firstChild);
        }

        this.showLoading('loadingBuyOrders');
        
        try {
            const trackedScids = this.getTrackedAssetScids ? this.getTrackedAssetScids() : new Set();
            const totalAssets = trackedScids.size;
            let processed = 0;

            const progressTextEl = document.getElementById('refreshProgressTextBuy');
            const progressFillEl = document.getElementById('refreshProgressFillBuy');

            const updateProgress = () => {
                if (progressTextEl) {
                    const percent = totalAssets > 0 ? Math.floor((processed / totalAssets) * 100) : 0;
                    progressTextEl.textContent = `Scanning on-chain orders... ${percent}% (${processed}/${totalAssets} assets)`;
                    if (progressFillEl) {
                        progressFillEl.style.width = `${percent}%`;
                    }
                }
            };

            updateProgress();

            // Fetch orders from all marketplaces
            const onChain = await this.fetchOnChainBuyOrders();
            processed = totalAssets;
            updateProgress();

            // Check if refresh was cancelled
            if (!this.refreshInProgress || !this.refreshInProgress.buy) {
                return;
            }

            // Save orders to local storage for persistence
            this.saveLocalOrders('buy', onChain);
            
            this.renderBuyOrders(onChain);
            if (typeof this.populateCollectionFilters === 'function') {
                this.populateCollectionFilters(onChain, 'buy');
            }

            // Remove progress UI
            const progressWrapper = document.getElementById('refreshProgressWrapperBuy');
            if (progressWrapper && progressWrapper.parentNode) {
                progressWrapper.parentNode.removeChild(progressWrapper);
            }
        } catch (error) {
            this.showError(`Failed to load buy orders: ${error.message}`);
            this.renderBuyOrders([]);
            
            // Remove progress UI on error
            const progressWrapper = document.getElementById('refreshProgressWrapperBuy');
            if (progressWrapper && progressWrapper.parentNode) {
                progressWrapper.parentNode.removeChild(progressWrapper);
            }
        } finally {
            if (this.refreshInProgress) {
                this.refreshInProgress.buy = false;
            }
            this.hideLoading('loadingBuyOrders');
        }
    };

    /* ------------------------------------------------------------------
     * Renderers
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.renderSellOrders = function(orders) {
        const container = document.getElementById('sellOrdersList');
        if (!container) return;

        // Apply type filter (All/NFT/NFA)
        const typeSel = document.getElementById('sellTypeFilter');
        const typeFilter = (typeSel?.value || 'all').toLowerCase();
        const kindOf = (order) => {
            const m = (order.marketplace || '').toLowerCase();
            if (m.includes('art-nfa-ms1') || m.includes('nfa')) return 'nfa';
            if (m.includes('g45')) return 'nft';
            // Fallback by presence of tokenId (NFT) vs none (may be NFA)
            return order.tokenId ? 'nft' : 'nfa';
        };
        const filtered = Array.isArray(orders)
            ? orders.filter(o => typeFilter === 'all' ? true : kindOf(o) === typeFilter)
            : [];

        if (!filtered || filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-tags"></i>
                    <h3>No sell orders yet</h3>
                    <p>Use "Add to Wallet" then the asset dropdown to create a sell order.</p>
                </div>
            `;
            return;
        }

        const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';

        container.innerHTML = filtered.map(order => `
            <div class="order-card" data-name="${order.asset || ''}" data-price="${order.price || 0}">
                ${order.image ? `
                    <div class="order-image-wrapper">
                        <img src="${order.image}" alt="${order.asset || 'Asset'}" onerror="this.style.display='none'">
                    </div>
                ` : ''}
                <div class="order-card-body">
                    <div class="order-card-header">
                        <span class="order-id">${order.id}</span>
                        <span class="order-status ${order.status || ORDER_STATUS.DRAFT}">
                            ${order.status || 'draft'}
                        </span>
                    </div>
                    <div class="order-card-details">
                        <div class="order-detail-row">
                            <span class="order-detail-label">Asset</span>
                            <span class="order-detail-value">${order.asset || 'NFT'}</span>
                        </div>
                        ${order.tokenId ? `
                        <div class="order-detail-row">
                            <span class="order-detail-label">Token ID</span>
                            <span class="order-detail-value">${order.tokenId}</span>
                        </div>` : ''}
                        <div class="order-detail-row">
                            <span class="order-detail-label">Price</span>
                            <span class="order-detail-value">${Number(order.price || 0).toFixed(4)} DERO</span>
                        </div>
                        <div class="order-detail-row">
                            <span class="order-detail-label">Marketplace</span>
                            <span class="order-detail-value">${order.marketplace || 'Local Draft'}</span>
                        </div>
                        <div class="order-detail-row">
                            <span class="order-detail-label">Created</span>
                            <span class="order-detail-value">${formatDate(order.createdAt)}</span>
                        </div>
                        <div class="order-detail-row">
                            <span class="order-detail-label">Expires</span>
                            <span class="order-detail-value">${formatDate(order.expiresAt)}</span>
                        </div>
                    </div>
                    <div class="order-card-actions">
                        <button class="btn btn-secondary" onclick="app.cancelOrder('${order.id}', 'sell')">
                            Cancel
                        </button>
                        <button class="btn btn-primary" onclick="app.editOrder('${order.id}', 'sell')">
                            Edit
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    };

    DeroNFTApp.prototype.renderBuyOrders = function(orders) {
        const container = document.getElementById('buyOrdersList');
        if (!container) return;

        // Apply type filter (All/NFT/NFA)
        const typeSel = document.getElementById('buyTypeFilter');
        const typeFilter = (typeSel?.value || 'all').toLowerCase();
        const kindOf = (order) => {
            const m = (order.marketplace || '').toLowerCase();
            if (m.includes('art-nfa-ms1') || m.includes('nfa')) return 'nfa';
            if (m.includes('g45')) return 'nft';
            return order.tokenId ? 'nft' : 'nfa';
        };
        const filtered = Array.isArray(orders)
            ? orders.filter(o => typeFilter === 'all' ? true : kindOf(o) === typeFilter)
            : [];

        if (!filtered || filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-shopping-cart"></i>
                    <h3>No buy orders yet</h3>
                    <p>Use "Add to Wallet" then the asset dropdown to create a buy order.</p>
                </div>
            `;
            return;
        }

        const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';

        container.innerHTML = filtered.map(order => `
            <div class="order-card" data-name="${order.asset || ''}" data-price="${order.price || 0}">
                ${order.image ? `
                    <div class="order-image-wrapper">
                        <img src="${order.image}" alt="${order.asset || 'Asset'}" onerror="this.style.display='none'">
                    </div>
                ` : ''}
                <div class="order-card-body">
                    <div class="order-card-header">
                        <span class="order-id">${order.id}</span>
                        <span class="order-status ${order.status || ORDER_STATUS.DRAFT}">
                            ${order.status || 'draft'}
                        </span>
                    </div>
                    <div class="order-card-details">
                        <div class="order-detail-row">
                            <span class="order-detail-label">Asset</span>
                            <span class="order-detail-value">${order.asset || 'NFT'}</span>
                        </div>
                        ${order.tokenId ? `
                        <div class="order-detail-row">
                            <span class="order-detail-label">Token ID</span>
                            <span class="order-detail-value">${order.tokenId}</span>
                        </div>` : ''}
                        <div class="order-detail-row">
                            <span class="order-detail-label">Offer</span>
                            <span class="order-detail-value">${Number(order.price || 0).toFixed(4)} DERO</span>
                        </div>
                        <div class="order-detail-row">
                            <span class="order-detail-label">Marketplace</span>
                            <span class="order-detail-value">${order.marketplace || 'Local Draft'}</span>
                        </div>
                        <div class="order-detail-row">
                            <span class="order-detail-label">Created</span>
                            <span class="order-detail-value">${formatDate(order.createdAt)}</span>
                        </div>
                        <div class="order-detail-row">
                            <span class="order-detail-label">Expires</span>
                            <span class="order-detail-value">${formatDate(order.expiresAt)}</span>
                        </div>
                    </div>
                    <div class="order-card-actions">
                        <button class="btn btn-secondary" onclick="app.cancelOrder('${order.id}', 'buy')">
                            Cancel
                        </button>
                        <button class="btn btn-primary" onclick="app.editOrder('${order.id}', 'buy')">
                            Edit
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    };

    /* ------------------------------------------------------------------
     * Order creators
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.createSellOrderForAsset = async function(scid, tokenId, assetName) {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
            return;
    };

    DeroNFTApp.prototype.showAssetSellOrderModal = async function(scid, tokenId, assetName) {
        const assetDetails = this.prepareAssetForOrder ? await this.prepareAssetForOrder(scid, tokenId, assetName) : { scid, tokenId, name: assetName };
        const resolvedName = (assetDetails && assetDetails.name) || assetName || (scid ? `NFT ${scid.substring(0, 8)}...` : 'NFT');
        const preppedDetails = assetDetails || null;
        const isArtAsset = this.isArtificerAsset ? this.isArtificerAsset(preppedDetails) : false;
        const isG45Asset = this.isG45Asset ? this.isG45Asset(preppedDetails) : true;
        const assetImage = (preppedDetails && preppedDetails.image) || (this.getPlaceholderImage ? this.getPlaceholderImage() : '');
        
        // Remove existing modal if any
        const existing = document.getElementById('assetSellOrderModal');
        if (existing) {
            existing.remove();
        }
        
        const modalHtml = `
            <div class="modal active" id="assetSellOrderModal" onclick="if(event.target.id === 'assetSellOrderModal') app.hideAssetSellOrderModal()">
                <div class="modal-content" style="max-width: 500px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">Create Sell Order</h2>
                        <button class="btn btn-secondary" onclick="app.hideAssetSellOrderModal()" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    ${assetImage ? `<img src="${assetImage}" alt="${resolvedName}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 15px;" onerror="this.style.display='none'">` : ''}
                    <div style="margin-bottom: 15px; color: #aaa; font-size: 0.9rem;">
                        <p style="margin: 0;"><strong>Asset:</strong> ${resolvedName}</p>
                        <p style="margin: 0;"><strong>SCID:</strong> ${scid}</p>
                        <p style="margin: 0;"><strong>Type:</strong> ${isArtAsset ? 'NFA' : isG45Asset ? 'NFT' : 'Asset'}</p>
                    </div>
                    <form id="assetSellOrderForm" onsubmit="app.submitAssetSellOrder(event, '${scid}', '${tokenId || ''}', '${resolvedName.replace(/'/g, "\\'")}', ${isArtAsset}, ${isG45Asset}); return false;">
                        <div class="form-group" style="margin-bottom: 15px;">
                            <label for="assetSellPrice" style="display: block; margin-bottom: 5px; font-weight: bold;">Sell Price (DERO):</label>
                            <input 
                                type="number" 
                                id="assetSellPrice" 
                                class="form-input" 
                                placeholder="10" 
                                value="10"
                                step="0.000001"
                                min="0.000001"
                                required
                                style="width: 100%;"
                            >
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label for="assetSellDuration" style="display: block; margin-bottom: 5px; font-weight: bold;">Duration (hours):</label>
                            <input 
                                type="number" 
                                id="assetSellDuration" 
                                class="form-input" 
                                placeholder="72" 
                                value="72"
                                min="1"
                                required
                                style="width: 100%;"
                            >
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="app.hideAssetSellOrderModal()" style="flex: 1;">
                                Cancel
                            </button>
                            <button type="submit" class="btn btn-primary" style="flex: 1;">
                                <i class="fas fa-arrow-down"></i> Create On-Chain Order
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Focus on price input
        setTimeout(() => {
            const input = document.getElementById('assetSellPrice');
            if (input) input.focus();
        }, 100);
    };

    DeroNFTApp.prototype.hideAssetSellOrderModal = function() {
        const modal = document.getElementById('assetSellOrderModal');
        if (modal) {
            modal.remove();
        }
    };

    DeroNFTApp.prototype.submitAssetSellOrder = async function(event, scid, tokenId, assetName, isArtAsset, isG45Asset) {
        event.preventDefault();
        
        try {
            const priceInput = document.getElementById('assetSellPrice').value.trim();
            const durationInput = document.getElementById('assetSellDuration').value.trim();
            
            if (!priceInput) {
                this.showError('Please enter a price.');
                return;
            }
            
            const price = parseFloat(priceInput);
            if (Number.isNaN(price) || price <= 0) {
                this.showError('Enter a valid numeric price');
                return;
            }

            const duration = durationInput ? parseInt(durationInput, 10) : 72;
            if (Number.isNaN(duration) || duration <= 0) {
                this.showError('Enter a valid duration in hours');
                return;
            }

            const preppedDetails = { scid, tokenId, name: assetName };
            
            // Close modal
            this.hideAssetSellOrderModal();
            this.showNotification?.('Creating sell order...', 'info');
            
            try {
                // NFAs use their own contract as marketplace (ART-NFA-MS1 standard)
                // Each NFA contract IS its own marketplace - no external marketplace needed
                if (isArtAsset) {
                    // NFA: Call Start() on the NFA contract itself + transfer 1 atomic unit to escrow
                    console.log('📤 [NFA Sell Order] Calling startArtificerSale...');
                    const resp = await this.startArtificerSale(preppedDetails || { scid, tokenId }, price, duration);
                    console.log('📨 [NFA Sell Order] startArtificerSale returned:', resp);
                    if (!resp) {
                        throw new Error('startArtificerSale returned no response. Check console for errors.');
                    }
                    const txid = resp?.result?.txid ?? resp?.txid;
                    if (txid) {
                        this.showSuccess(`✅ NFA listing submitted (txid: ${txid.substring(0, 16)}...).`);
                    } else {
                        this.showSuccess('✅ NFA listing submitted (check console for transaction ID).');
                    }
                } else if (isG45Asset) {
                    // NFT: Use external G45 marketplace contract
                    const resp = await this.createG45MarketplaceListing(preppedDetails || { scid, tokenId }, price, duration);
                    const txid = resp?.result?.txid;
                    this.showSuccess(`NFT listing submitted${txid ? ` (txid: ${txid})` : ''}.`);
                } else {
                    throw new Error('Unsupported asset type for marketplace listing.');
                }
                if (this.applyOwnershipUpdateFromAction) {
                    this.applyOwnershipUpdateFromAction(scid, tokenId, 'in-contract');
                }
                // Refresh buy/sell tabs to show the new order
                if (this.currentTab === 'sell') {
                    this.loadSellOrders();
                } else if (this.currentTab === 'buy') {
                    this.loadBuyOrders();
                }
            } catch (error) {
                this.showError(`On-chain sell order failed: ${error.message}`);
            }
        } catch (error) {
            this.showError(`Failed to create sell order: ${error.message}`);
        }
    };

    DeroNFTApp.prototype.createBuyOrderForAsset = async function(scid, tokenId, assetName) {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
            return;
    };

    DeroNFTApp.prototype.showAssetBuyOrderModal = async function(scid, tokenId, assetName) {
        const assetDetails = this.prepareAssetForOrder ? await this.prepareAssetForOrder(scid, tokenId, assetName) : null;
        const resolvedName = (assetDetails && assetDetails.name) || assetName || (scid ? `NFT ${scid.substring(0, 8)}...` : 'NFT');
        const isArtAsset = this.isArtificerAsset ? this.isArtificerAsset(assetDetails) : false;
        const isG45Asset = this.isG45Asset ? this.isG45Asset(assetDetails) : true;
        const assetImage = (assetDetails && assetDetails.image) || (this.getPlaceholderImage ? this.getPlaceholderImage() : '');
        
        // Remove existing modal if any
        const existing = document.getElementById('assetBuyOrderModal');
        if (existing) {
            existing.remove();
        }
        
        const modalHtml = `
            <div class="modal active" id="assetBuyOrderModal" onclick="if(event.target.id === 'assetBuyOrderModal') app.hideAssetBuyOrderModal()">
                <div class="modal-content" style="max-width: 500px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">Create Buy Order</h2>
                        <button class="btn btn-secondary" onclick="app.hideAssetBuyOrderModal()" style="padding: 8px 16px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    ${assetImage ? `<img src="${assetImage}" alt="${resolvedName}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 15px;" onerror="this.style.display='none'">` : ''}
                    <div style="margin-bottom: 15px; color: #aaa; font-size: 0.9rem;">
                        <p style="margin: 0;"><strong>Asset:</strong> ${resolvedName}</p>
                        <p style="margin: 0;"><strong>SCID:</strong> ${scid}</p>
                        <p style="margin: 0;"><strong>Type:</strong> ${isArtAsset ? 'NFA' : isG45Asset ? 'NFT' : 'Asset'}</p>
                    </div>
                    <form id="assetBuyOrderForm" onsubmit="app.submitAssetBuyOrder(event, '${scid}', '${tokenId || ''}', '${resolvedName.replace(/'/g, "\\'")}', ${isArtAsset}, ${isG45Asset}); return false;">
                        <div class="form-group" style="margin-bottom: 15px;">
                            <label for="assetBuyPrice" style="display: block; margin-bottom: 5px; font-weight: bold;">Buy Offer (DERO):</label>
                            <input 
                                type="number" 
                                id="assetBuyPrice" 
                                class="form-input" 
                                placeholder="5" 
                                value="5"
                                step="0.000001"
                                min="0.000001"
                                required
                                style="width: 100%;"
                            >
                            <small style="color: #aaa; font-size: 0.85rem;">This amount will be escrowed in the marketplace</small>
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label for="assetBuyDuration" style="display: block; margin-bottom: 5px; font-weight: bold;">Duration (hours):</label>
                            <input 
                                type="number" 
                                id="assetBuyDuration" 
                                class="form-input" 
                                placeholder="48" 
                                value="48"
                                min="1"
                                required
                                style="width: 100%;"
                            >
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="app.hideAssetBuyOrderModal()" style="flex: 1;">
                                Cancel
                            </button>
                            <button type="submit" class="btn btn-primary" style="flex: 1;">
                                <i class="fas fa-arrow-up"></i> Create On-Chain Order
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Focus on price input
        setTimeout(() => {
            const input = document.getElementById('assetBuyPrice');
            if (input) input.focus();
        }, 100);
    };

    DeroNFTApp.prototype.hideAssetBuyOrderModal = function() {
        const modal = document.getElementById('assetBuyOrderModal');
        if (modal) {
            modal.remove();
        }
    };

    DeroNFTApp.prototype.submitAssetBuyOrder = async function(event, scid, tokenId, assetName, isArtAsset, isG45Asset) {
        event.preventDefault();
        
        try {
            const priceInput = document.getElementById('assetBuyPrice').value.trim();
            const durationInput = document.getElementById('assetBuyDuration').value.trim();
            
            if (!priceInput) {
                this.showError('Please enter a price.');
                return;
            }
            
            const price = parseFloat(priceInput);
            if (Number.isNaN(price) || price <= 0) {
                this.showError('Enter a valid numeric price');
                return;
            }

            const duration = durationInput ? parseInt(durationInput, 10) : 48;
            if (Number.isNaN(duration) || duration <= 0) {
                this.showError('Enter a valid duration in hours');
                return;
            }

            const assetDetails = { scid, tokenId, name: assetName };
            
            // Close modal
            this.hideAssetBuyOrderModal();
            this.showNotification?.('Creating buy order...', 'info');
            
            try {
                if (isArtAsset) {
                    const resp = await this.startArtificerBuyNow(assetDetails || { scid }, price);
                    const txid = resp?.result?.txid;
                    this.showSuccess(`Buy order submitted${txid ? ` (txid: ${txid})` : ''}.`);
                } else if (isG45Asset) {
                    const resp = await this.createG45MarketplaceBuyOrder(assetDetails || { scid, tokenId }, price, duration);
                    const txid = resp?.result?.txid;
                    this.showSuccess(`Buy order submitted${txid ? ` (txid: ${txid})` : ''}.`);
                } else {
                    throw new Error('Unsupported asset type for marketplace buy orders.');
                }
                // Refresh buy/sell tabs to show the new order
                if (this.currentTab === 'buy') {
                    this.loadBuyOrders();
                } else if (this.currentTab === 'sell') {
                    this.loadSellOrders();
                }
            } catch (error) {
                this.showError(`On-chain buy order failed: ${error.message}`);
            }
        } catch (error) {
            this.showError(`Failed to create buy order: ${error.message}`);
        }
    };

    DeroNFTApp.prototype.prepareAssetForOrder = async function(scid, tokenId, assetName) {
        if (!scid) {
            return {
                scid: '',
                tokenId: tokenId || 0,
                name: assetName || 'NFT'
            };
        }

        if (this.queryG45AT) {
            try {
                const chainAsset = await this.queryG45AT(scid, { forceRefresh: true });
                if (chainAsset) {
                    return {
                        ...chainAsset,
                        tokenId: tokenId !== undefined && tokenId !== null ? tokenId : chainAsset.tokenId || 0,
                        name: chainAsset.name || assetName || `NFT ${scid.substring(0, 8)}...`
                    };
                }
            } catch (error) {
                // Ignore metadata fetch errors
            }
        }

        return {
            scid,
            tokenId: tokenId || 0,
            name: assetName || `NFT ${scid.substring(0, 8)}...`
        };
    };

    DeroNFTApp.prototype.createG45MarketplaceListing = async function(asset, priceDero, durationHours) {
        if (!this.callContractEntry) {
            throw new Error('Wallet connection not available for marketplace listing.');
        }
        const marketScid = this.ensureG45MarketplaceScid ? this.ensureG45MarketplaceScid(true) : '';
        if (!marketScid || marketScid.length !== 64) {
            throw new Error('G45 marketplace SCID is not configured.');
        }
        
        // Validate marketplace SCID exists (optional check - don't block if it fails)
        try {
            const marketScResult = await this.deroWallet.ws.getSC(marketScid);
            if (marketScResult && (marketScResult.result || marketScResult.status === 'OK')) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        } catch (error) {
            // Ignore validation errors
        }
        
        // Normalize asset SCID to lowercase to ensure wallet can decode it properly
        const normalizedAssetScid = asset.scid.toLowerCase().trim();
        const normalizedMarketScid = marketScid.toLowerCase().trim();
        
        // Check initial balance before transaction
        let initialBalance = 0;
        try {
            const balanceCheck = await this.deroWallet?.ws?.sendRequest('GetBalance', { scid: normalizedAssetScid });
            initialBalance = balanceCheck?.result?.balance || 0;
            console.log(`💰 [G45 Marketplace List] Initial NFT balance: ${initialBalance} atomic units`);
            
            if (initialBalance < 100000) {
                this.showError('You do not own this NFT. Balance is less than 100,000 atomic units (required for NFT ownership).');
                return;
            }
        } catch (balanceError) {
            console.warn('⚠️ [G45 Marketplace List] Could not check initial balance:', balanceError);
            // Continue anyway - let the contract reject if balance is insufficient
        }
        
        // Validate asset SCID exists and ensure wallet has it in state tree
        try {
            const assetScResult = await this.deroWallet.ws.getSC(normalizedAssetScid);
            if (assetScResult && (assetScResult.result || assetScResult.status === 'OK')) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        } catch (error) {
            // Ignore validation errors
        }
        
        // Determine asset type and use correct transfer amount
        const isNFA = this.isArtificerAsset ? this.isArtificerAsset(asset) : false;
        const isNFT = this.isG45Asset ? this.isG45Asset(asset) : true; // Default to NFT if unknown
        
        // IMPORTANT: NFT/NFA asset balance is fixed and represents ownership
        // NFT: 1 owner = 100,000 atomic units (never changes) - ORED ALWAYS uses 100,000 for NFT transfers
        // NFA: 1 owner = 1 atomic unit (never changes)
        // This is the asset balance being transferred, NOT the price
        // ORED always uses these fixed amounts regardless of what was displayed or custom amounts used elsewhere
        const transferAmount = isNFA ? 1 : 100000;
        // User can check balance in Engram's calls tab if transaction fails
        
        // Format per DERO docs: transfers array contains scid (asset SCID) and burn amount
        // TRANSFER DESTINATION: When using 'burn' with 'scid', asset automatically goes to contract in main scid param
        // Main scid parameter (normalizedMarketScid) = G45 Marketplace SCID = destination for the asset
        // For NFT: 100,000 atomic units goes to marketplace contract
        // For NFA: This function should NOT be used for NFA (use startArtificerSale instead)
        // Reference: https://github.com/deroproject/documentation/blob/master/DVMDOCS/examples/assetexchange/example.sh
        // Asset transfers with scid + burn do NOT need destination field - asset goes to contract automatically
        const transfers = [{
            scid: normalizedAssetScid,         // The SCID of the asset being sent
            burn: transferAmount               // Fixed: 100k for NFT, 1 for NFA (burned to marketplace contract)
        }];
        
        // priceDero is in whole DERO units (user input)
        // Convert to atomic units for contract (1 DERO = 100,000 atomic units)
        const priceAtomic = this.deroToAtomic ? this.deroToAtomic(priceDero) : Math.floor(priceDero * 100000);
        // Contract expects: List(asset_scid String, price Uint64, duration Uint64, token_id Uint64)
        const scRpc = [
            { name: 'asset_scid', datatype: 'S', value: normalizedAssetScid },
            { name: 'price', datatype: 'U', value: priceAtomic },
            { name: 'duration', datatype: 'U', value: durationHours },
            { name: 'token_id', datatype: 'U', value: asset.tokenId || 0 }
        ];
        let response;
        try {
            response = await this.callContractEntry(normalizedMarketScid, 'List', scRpc, { transfers: transfers });
        } catch (error) {
            this.logTransactionError?.('G45 Marketplace List', error, {
                scid: normalizedMarketScid,
                entrypoint: 'List',
                assetScid: normalizedAssetScid,
                price: priceAtomic,
                duration: durationHours,
                tokenId: asset.tokenId || 0,
                transfers
            });
            return;
        }
        
        // Check for contract return value (error codes)
        // G45 contract returns: listingId (success, > 0) or 1 (error)
        // Response structure can be: { txid: "..." } or { result: { txid: "...", value: ... } }
        const txid = response?.result?.txid ?? response?.txid;
        const returnValue = response?.result?.value ?? response?.value;
        
        // Log the full response for debugging
        console.log('📨 [G45 Marketplace List] Full response:', JSON.stringify(response, null, 2));
        console.log('📊 [G45 Marketplace List] Return value:', returnValue, 'TXID:', txid);
        
        if (!txid) {
            this.showError('Transaction submitted but no transaction ID received. Please check wallet.');
            return;
        }
        
        // If we don't have a return value in the response, check the transaction
        if (returnValue === undefined || returnValue === null) {
            console.log('⚠️ [G45 Marketplace List] No return value in response, checking transaction...');
            // Wait a moment for transaction to be mined, then check it
            setTimeout(async () => {
                try {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Check transaction return value - try multiple parameter formats
                    let txCheck = null;
                    try {
                        // Format 1: Standard format
                        txCheck = await this.deroWallet?.ws?.sendRequest('DERO.GetTransaction', { 
                            txs_hashes: [txid], 
                            decode_as_json: true 
                        });
                    } catch (e1) {
                        try {
                            // Format 2: Without decode_as_json
                            txCheck = await this.deroWallet?.ws?.sendRequest('DERO.GetTransaction', { 
                                txs_hashes: [txid]
                            });
                        } catch (e2) {
                            try {
                                // Format 3: tx_hashes (singular) - some wallets use this
                                txCheck = await this.deroWallet?.ws?.sendRequest('DERO.GetTransaction', { 
                                    tx_hashes: [txid]
                                });
                            } catch (e3) {
                                console.warn('⚠️ [G45 Marketplace List] All GetTransaction formats failed, skipping return value check');
                            }
                        }
                    }
                    const txResult = txCheck?.result?.txs?.[0];
                    if (txResult?.payload_rpc) {
                        const returnParam = txResult.payload_rpc.find(p => p.name === 'return' || p.datatype === 'return');
                        if (returnParam && returnParam.value !== undefined && returnParam.value !== null) {
                            const actualReturnValue = returnParam.value;
                            console.log('📊 [G45 Marketplace List] Transaction return value:', actualReturnValue);
                            
                            if (actualReturnValue === 1) {
                                // Contract rejected
                                const contractError = new Error('Listing rejected by contract. Possible reasons: 1) Address not registered, 2) Price is 0, 3) Insufficient asset balance (need 100,000 atomic units), 4) Contract not initialized.');
                                this.logTransactionError?.('G45 Marketplace List - Contract Rejection', contractError, {
                                    scid: normalizedMarketScid,
                                    entrypoint: 'List',
                                    returnValue: actualReturnValue,
                                    txid,
                                    assetScid: normalizedAssetScid,
                                    transferAmount,
                                    price: priceAtomic
                                });
                                return;
                            } else if (actualReturnValue > 1) {
                                // Success - return value is the listing ID
                                this.showSuccess(`✅ Listing created successfully! Listing ID: ${actualReturnValue} (txid: ${txid})`);
                            }
                        }
                    }
                } catch (verifyError) {
                    console.warn('⚠️ [G45 Marketplace List] Could not check transaction return value:', verifyError);
                }
            }, 1000);
        }
        
        // Also check for error in response
        if (response?.error) {
            const error = new Error(`Transaction failed: ${response.error.message || 'Unknown error'}`);
            this.logTransactionError?.('G45 Marketplace List - Response Error', error, {
                scid: normalizedMarketScid,
                entrypoint: 'List',
                response,
                txid
            });
            return;
        }
        
        // Check return value if we have it immediately
        if (returnValue !== undefined && returnValue !== null && returnValue !== 'undefined') {
            if (returnValue === 1) {
                // Contract rejected: Could be unregistered address, price = 0, or insufficient asset balance
                const contractError = new Error('Listing rejected by contract. Possible reasons: 1) Address not registered, 2) Price is 0, 3) Insufficient asset balance (need 100,000 atomic units), 4) Contract not initialized.');
                this.logTransactionError?.('G45 Marketplace List - Contract Rejection', contractError, {
                    scid: normalizedMarketScid,
                    entrypoint: 'List',
                    returnValue,
                    txid,
                    response,
                    assetScid: normalizedAssetScid,
                    price: priceAtomic
                });
                return;
            } else if (returnValue === 0 || returnValue < 0) {
                const contractError = new Error(`Listing rejected by contract: Returned error code ${returnValue}`);
                this.logTransactionError?.('G45 Marketplace List - Contract Rejection', contractError, {
                    scid: normalizedMarketScid,
                    entrypoint: 'List',
                    returnValue,
                    txid,
                    response
                });
                return;
            }
            // Success: returnValue is the listing ID (> 0)
            console.log(`✅ [G45 Marketplace] Listing created successfully:`, {
                listingId: returnValue,
                txid,
                assetScid: normalizedAssetScid.substring(0, 16) + '...',
                price: priceAtomic
            });
            this.showSuccess?.(`✅ Listing created successfully! Listing ID: ${returnValue}`);
        } else {
            // No return value in response - verify transaction and check contract state after a delay
            if (txid) {
                this.showNotification(`Transaction submitted (txid: ${txid}). Verifying listing...`, 'info', 0);
                
                // Wait for transaction to be mined, then check return value and balance
                setTimeout(async () => {
                    try {
                        // Check transaction return value if available
                        const txCheck = await this.deroWallet?.ws?.sendRequest('DERO.GetTransaction', { 
                            txs_hashes: [txid], 
                            decode_as_json: true 
                        });
                        const txResult = txCheck?.result?.txs?.[0];
                        if (txResult?.payload_rpc) {
                            const returnParam = txResult.payload_rpc.find(p => p.name === 'return' || p.datatype === 'return');
                            if (returnParam && returnParam.value !== undefined && returnParam.value !== null && returnParam.value === 1) {
                                console.error('❌ [G45 Marketplace List] Contract rejected transaction: Return value = 1');
                                this.showError('Listing rejected by contract. Possible reasons: 1) Address not registered, 2) Price is 0, 3) Insufficient asset balance (need 100,000 atomic units), 4) Contract not initialized.');
                                return;
                            }
                        }
                        
                        // Wait a bit longer for the transaction to be processed
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Check balance to verify NFT was transferred
                        const balanceCheck = await this.deroWallet?.getBalance(null, normalizedAssetScid);
                        const newBalance = balanceCheck || 0;
                        console.log(`💰 [G45 Marketplace List] NFT balance after transaction: ${newBalance} atomic units (was ${initialBalance})`);
                        
                        // For NFTs, listing transfers 100,000 atomic units to the marketplace contract
                        // So balance should decrease by 100,000 (from initialBalance to initialBalance - 100000)
                        const expectedBalance = initialBalance - 100000;
                        const balanceDifference = initialBalance - newBalance;
                        
                        console.log(`💰 [G45 Marketplace List] Balance verification: initial=${initialBalance}, new=${newBalance}, expected=${expectedBalance}, difference=${balanceDifference}`);
                        
                        // Allow some tolerance for rounding (within 1 atomic unit)
                        if (Math.abs(balanceDifference - 100000) <= 1) {
                            console.log(`✅ [G45 Marketplace List] Balance decreased correctly: ${initialBalance} -> ${newBalance} (difference: ${balanceDifference}, expected: 100000) - NFT transfer confirmed`);
                            this.showSuccess(`✅ NFT listing created successfully! Transaction: ${txid.substring(0, 16)}... Your NFT balance decreased by 100,000 atomic units.`);
                        } else if (newBalance >= initialBalance) {
                            // Balance didn't decrease at all - transaction likely failed
                            console.warn('⚠️ [G45 Marketplace List] WARNING: NFT balance did not decrease after transaction.');
                            this.showError(`Transaction submitted but NFT balance did not decrease (was ${initialBalance}, now ${newBalance}). The contract may have rejected the transfer. Check the transaction status: ${txid}`);
                        } else if (balanceDifference > 0 && balanceDifference >= 50000) {
                            // Partial decrease - some amount was transferred but not the full 100k
                            console.warn(`⚠️ [G45 Marketplace List] Partial balance decrease: ${balanceDifference} (expected 100000)`);
                            this.showNotification(`Transaction submitted but balance verification unclear (difference: ${balanceDifference}, expected: 100000). Check transaction: ${txid}`, 'warning');
                        } else {
                            // Balance didn't decrease significantly
                            console.warn(`⚠️ [G45 Marketplace List] Balance did not decrease significantly: ${balanceDifference} atomic units`);
                            this.showError(`Transaction submitted but NFT balance did not decrease (was ${initialBalance}, now ${newBalance}). The contract may have rejected the transfer. Check the transaction status: ${txid}`);
                        }
                        
                        // Check contract state for listing
                        const scResult = await this.deroWallet.ws.getSC(normalizedMarketScid, false, true);
                        const scData = scResult?.result || scResult;
                        const stringKeys = scData?.stringkeys || {};
                        const uint64Keys = scData?.uint64keys || {};
                        const listingCounter = uint64Keys['listingCounter'] || stringKeys['listingCounter'];
                        if (listingCounter && parseInt(listingCounter) > 0) {
                            this.showSuccess(`✅ Listing may have been created. Check the marketplace for listing ID: ${listingCounter}`);
                        } else {
                            this.showError('⚠️ Transaction sent but listing not found. The contract may have rejected it. Check your wallet balance - the NFT should have been returned.');
                        }
                    } catch (error) {
                        console.error('Failed to verify listing:', error);
                    }
                }, 3000);
            }
        }
        
        return response;
    };

    DeroNFTApp.prototype.createG45MarketplaceBuyOrder = async function(asset, priceDero, durationHours) {
        if (!this.callContractEntry) {
            throw new Error('Wallet connection not available for marketplace buy order.');
        }
        const marketScid = this.ensureG45MarketplaceScid ? this.ensureG45MarketplaceScid(true) : '';
        if (!marketScid || marketScid.length !== 64) {
            throw new Error('G45 marketplace SCID is not configured.');
        }
        
        // priceDero is in whole DERO units (user input)
        // Convert to atomic units for contract (1 DERO = 100,000 atomic units)
        const priceAtomic = this.deroToAtomic ? this.deroToAtomic(priceDero) : Math.floor(priceDero * 100000);
        // Normalize SCIDs to lowercase to ensure wallet can decode them properly
        const normalizedMarketScid = marketScid.toLowerCase().trim();
        const normalizedAssetScid = asset.scid.toLowerCase().trim();
        
        // Contract expects: CreateBuyOrder(asset_scid String, price Uint64, duration Uint64, token_id Uint64)
        const scRpc = [
            { name: 'asset_scid', datatype: 'S', value: normalizedAssetScid },
            { name: 'price', datatype: 'U', value: priceAtomic },
            { name: 'duration', datatype: 'U', value: durationHours },
            { name: 'token_id', datatype: 'U', value: asset.tokenId || 0 }
        ];
        // CreateBuyOrder requires sending DERO to the marketplace contract as escrow
        // amount must be in atomic units
        const response = await this.callContractEntry(normalizedMarketScid, 'CreateBuyOrder', scRpc, { amount: priceAtomic });
        
        // Check for contract return value (error codes)
        // G45 contract returns: buyOrderId (success, > 0) or 1 (error)
        const returnValue = response?.result?.value;
        if (returnValue !== undefined && returnValue !== null) {
            if (returnValue === 1) {
                throw new Error('Buy order rejected by contract: Invalid parameters, insufficient DERO, or contract not initialized. Your DERO should have been returned to your wallet.');
            } else if (returnValue === 0 || returnValue < 0) {
                throw new Error(`Buy order rejected by contract: Returned error code ${returnValue}. Your DERO should have been returned to your wallet.`);
            }
            // Success: returnValue is the buy order ID (> 0)
        }
        
        return response;
    };

    /* ------------------------------------------------------------------
     * Dropdown shims (search/view actions)
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.createSellOrderFromSearch = function(index) {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
            return;
    };

    DeroNFTApp.prototype.createBuyOrderFromSearch = function(index) {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
            return;
    };

    DeroNFTApp.prototype.closeOrdersFromSearch = function(index) {
        if (!Array.isArray(this.lastSearchResults) || !this.lastSearchResults[index]) {
            this.showError('Search result not found');
            return;
        }
        const item = this.lastSearchResults[index];
        this.closeOrdersForAsset(item.scid, item.tokenId);
    };

    /* ------------------------------------------------------------------
     * Basic tab-level buttons
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.createSellOrder = function() {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
    };

    DeroNFTApp.prototype.createBuyOrder = function() {
        // Trading features disabled - show coming soon message
        this.showNotification('Trading features coming soon.', 'info');
    };

    // Asset Selection Modal functions moved to appfeat7.js to reduce file size
}

