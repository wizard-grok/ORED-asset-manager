    DeroNFTApp.prototype.isAssetInCache = function(scid) {
        if (!scid) {
            return false;
        }
        const cache = this.assetsCache?.value;
        if (!cache) {
            return false;
        }
        const list = Array.isArray(cache) ? cache : cache.nfts;
        if (!Array.isArray(list)) {
            return false;
        }
        return list.some(item => {
            const itemId = (item.id || '').toLowerCase();
            const itemScid = (item.scid || '').toLowerCase();
            const target = scid.toLowerCase();
            return itemScid === target || itemId === target || itemId.startsWith(`${target}_`);
        });
    }

    DeroNFTApp.prototype.getPlaceholderImage = function() {
        if (!this.defaultAssetImage) {
            this.defaultAssetImage = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="%231a1e2e"/><text x="50%" y="50%" fill="%238c97b5" font-size="20" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">ORED</text></svg>';
        }
        return this.defaultAssetImage;
    }

    DeroNFTApp.prototype.syncOwnershipFromSaved = function(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return;
        }
        const saved = Array.isArray(this.savedAssets) ? this.savedAssets : [];
        if (saved.length === 0) {
            return;
        }
        const normalize = (value) => (value || '').toString().toLowerCase();
        const savedIds = new Set();
        saved.forEach(asset => {
            if (!asset) {
                return;
                }
            const idCandidates = [
                asset.id,
                asset.scid,
                asset.tokenId && asset.scid ? `${asset.scid}_${asset.tokenId}` : ''
            ];
            idCandidates.forEach(candidate => {
                if (candidate) {
                    savedIds.add(normalize(candidate));
                }
            });
        });
        if (savedIds.size === 0) {
            return;
        }
        items.forEach(item => {
            if (!item) {
                return;
            }
            const checkIds = [
                item.id,
                item.scid,
                item.tokenId && item.scid ? `${item.scid}_${item.tokenId}` : ''
            ].map(normalize);
            if (checkIds.some(id => id && savedIds.has(id))) {
                item.owned = true;
            }
        });
    }


    DeroNFTApp.prototype.getTransfersForAnalysis = async function(forceRefresh = false) {
        if (!this.deroWallet || !this.currentAddress) {
            return [];
        }
        const now = Date.now();
        if (!forceRefresh && this.transfersCache?.value && (now - this.transfersCache.timestamp) < this.cacheTimeout) {
            return this.transfersCache.value;
        }
        const transfers = await this.deroWallet.getAssets(this.currentAddress);
        this.transfersCache = { value: transfers, timestamp: Date.now() };
        return transfers;
    }

    DeroNFTApp.prototype.ensureTransferAssetCache = async function(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.transferAssetCache?.assets && (now - this.transferAssetCache.timestamp) < this.cacheTimeout) {
            return this.transferAssetCache.assets;
        }
        const transfers = await this.getTransfersForAnalysis(forceRefresh);
        const parsedAssets = await this.parseAssetsFromTransfers ? await this.parseAssetsFromTransfers(transfers || []) : [];
        this.transferAssetCache = {
            assets: parsedAssets,
            timestamp: Date.now()
        };
        return parsedAssets;
    }


    DeroNFTApp.prototype.getSearchResultStatus = function(item, isCollection = false) {
        if (!item) {
            return { text: 'Unknown', className: 'status-unknown' };
        }

        if (isCollection || item.isCollection || (item.type && item.type.toLowerCase() === 'collection')) {
            return { text: 'Collection', className: 'status-collection' };
        }

        // Only show ownership status if it has been explicitly checked
        // Search results should show neutral status (just asset type)
        const statusOverride = (item.ownershipStatus || '').toLowerCase();
        
        // If ownership has been explicitly checked, show the status
        if (statusOverride === 'displayed') {
            return { text: 'Owned · Displayed', className: 'status-owned status-displayed' };
        }
        if (statusOverride === 'in-contract') {
            return { text: 'In Smart Contract', className: 'status-in-contract' };
        }
        if (statusOverride === 'owned') {
            return { text: 'Owned', className: 'status-owned' };
        }
        if (statusOverride === 'not-owned') {
            return { text: 'Not Owned', className: 'status-not-owned' };
        }
        if (statusOverride === 'unknown') {
            return { text: 'Unknown', className: 'status-unknown' };
        }

        // For search results without explicit ownership check, show neutral status
        // Just show the asset type (NFT/NFA) without ownership information
        const assetType = (item.type || 'NFT').toUpperCase();
        return { 
            text: assetType, 
            className: `status-${assetType.toLowerCase()}` 
        };
    }

    DeroNFTApp.prototype.applySorting = function(containerId, sortBy) {
        const container = document.getElementById(containerId);
        if (!container) {
            return;
        }
        const cards = Array.from(container.children);
        if (cards.length === 0) {
            return;
        }

        cards.sort((a, b) => {
            const getDate = (el) => new Date(el.dataset.date || 0).getTime();
            const getName = (el) => (el.dataset.name || '').toLowerCase();
            const getPrice = (el) => parseFloat(el.dataset.price || '0');
            const getCollection = (el) => (el.dataset.collection || '').toLowerCase();

            switch (sortBy) {
                case 'date-desc':
                    return getDate(b) - getDate(a);
                case 'date-asc':
                    return getDate(a) - getDate(b);
                case 'name-desc':
                    return getName(b).localeCompare(getName(a));
                case 'name-asc':
                    return getName(a).localeCompare(getName(b));
                case 'price-desc':
                    return getPrice(b) - getPrice(a);
                case 'price-asc':
                    return getPrice(a) - getPrice(b);
                case 'collection-desc':
                    return getCollection(b).localeCompare(getCollection(a));
                case 'collection-asc':
                    return getCollection(a).localeCompare(getCollection(b));
                default:
                    return 0;
            }
        });

        container.innerHTML = '';
        cards.forEach(card => container.appendChild(card));
    }

    DeroNFTApp.prototype.populateCollectionFilters = function(items, type) {
        if (!Array.isArray(items)) {
            return;
        }
        const filterId = type === 'sell' ? 'sellCollectionFilter'
            : type === 'buy' ? 'buyCollectionFilter'
            : 'collectionFilter';
        const filter = document.getElementById(filterId);
        if (!filter) {
            return;
        }

        const extractName = (item) => item?.collection || item?.collection_name || item?.collection_scid || '';
        const collections = [...new Set(items.map(extractName).filter(Boolean))];
        const previousValue = filter.value;
        filter.innerHTML = '<option value="">All Collections</option>';

        collections.forEach(collection => {
            const option = document.createElement('option');
            option.value = collection;
            option.textContent = collection;
            filter.appendChild(option);
        });

        if (previousValue && collections.includes(previousValue)) {
            filter.value = previousValue;
        }
    }

    DeroNFTApp.prototype.setupFeatureEventListeners = function() {
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', (event) => {
                event?.preventDefault();
                this.performSearch();
            });
        }

        const searchInput = document.getElementById('searchQuery');
        if (searchInput) {
            searchInput.addEventListener('keyup', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.performSearch();
                }
            });
        }

        const refreshAssetsBtn = document.getElementById('refreshAssets');
        if (refreshAssetsBtn) {
            refreshAssetsBtn.disabled = true;
            refreshAssetsBtn.addEventListener('click', (event) => {
                event?.preventDefault();
                this.showNotification?.('Bulk refresh is disabled for now. Use targeted search and collection scans to update assets.', 'info');
            });
        }

        const scanGnomonBtn = document.getElementById('scanGnomonBtn');
        if (scanGnomonBtn) {
            scanGnomonBtn.addEventListener('click', (event) => {
                event?.preventDefault();
                if (this.scanGnomonForAssets) {
                    this.scanGnomonForAssets();
                }
            });
        }

        const sendForm = document.getElementById('sendForm');
        if (sendForm) {
            sendForm.addEventListener('submit', (event) => {
                event?.preventDefault();
                if (this.handleSendForm) {
                    this.handleSendForm(event);
                }
            });
        }

        const collectionFilter = document.getElementById('collectionFilter');
        const typeFilter = document.getElementById('typeFilter');
        const assetSortBy = document.getElementById('assetSortBy');
        [collectionFilter, typeFilter, assetSortBy].forEach((select) => {
            if (select) {
                select.addEventListener('change', () => {
                    if (this.assetsCache?.value) {
                        this.renderAssetsWithOrders(this.assetsCache.value);
                    }
                });
            }
        });

        // Orders type filters
        const sellTypeFilter = document.getElementById('sellTypeFilter');
        if (sellTypeFilter) {
            sellTypeFilter.addEventListener('change', () => {
                if (this.loadSellOrders) this.loadSellOrders(true); // Force refresh on tab switch
            });
        }
        const buyTypeFilter = document.getElementById('buyTypeFilter');
        if (buyTypeFilter) {
            buyTypeFilter.addEventListener('change', () => {
                if (this.loadBuyOrders) this.loadBuyOrders(true); // Force refresh on tab switch
            });
        }

        if (!this.boundDropdownCloser) {
            this.boundDropdownCloser = (event) => {
                const insideDropdown = event.target.closest('.card-dropdown');
                if (!insideDropdown && this.closeAllDropdowns) {
                    this.closeAllDropdowns();
                }
            };
            document.addEventListener('click', this.boundDropdownCloser);
        }

        // Removed auto-close on dropdown item click - dropdown will stay open until clicked outside
        // This allows users to see confirmation/checkmark after adding to wallet
    }

    DeroNFTApp.prototype.renderAssetCard = function(item, index, context = 'search') {
        if (!item) return '';

        const isCollection = item.isCollection || (item.type && item.type.toLowerCase() === 'collection');
        const normalizedType = this.classifyAssetType
            ? this.classifyAssetType(item.contractType, item.type, isCollection)
            : (isCollection ? 'Collection' : (item.type || 'NFT'));
        item.type = normalizedType;

        const status = this.getSearchResultStatus(item, isCollection);
        const name = item.name || (isCollection ? `Collection ${item.scid ? item.scid.substring(0, 8) : ''}` : 'Unnamed');
        const fallbackImage = this.getPlaceholderImage ? this.getPlaceholderImage() : '';
        const imageSrc = item.image || fallbackImage;
        const hasScid = Boolean(item.scid);
        const hasTokenId = Boolean(item.tokenId);
        const ownershipContext = context === 'view'
            ? 'view'
            : (context === 'collection' ? 'collection' : (isCollection ? 'collection' : 'search'));
        const assetId = item.id || (item.scid && item.tokenId ? `${item.scid}_${item.tokenId}` : item.scid || `asset-${context}-${index}`);
        const assetDomKey = (assetId || `asset-${context}-${index}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        const dropdownId = `${context}-dropdown-${assetDomKey}`;
        const cardId = `${context}-card-${assetDomKey}`;
        const escapeHtml = (value) => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const escapeAttr = (value) => String(value ?? '').replace(/'/g, "\\'");
        const safeName = escapeHtml(name);
        const assetIdAttr = escapeAttr(assetId);
        const assetDomAttr = escapeAttr(assetDomKey);
        const scidAttr = escapeAttr(item.scid || '');
        const tokenAttr = escapeAttr(item.tokenId || '');
        const collectionLabel = escapeAttr(item.collection_name || item.collection || item.collection_scid || '');
        const dateAttr = escapeAttr(item.addedAt || item.created_at || item.date || '');
        const priceAttr = escapeAttr(item.price || item.listing_price || 0);

        const dropdownItems = [];

        if (context === 'view') {
            dropdownItems.push(`
                <div class="card-dropdown-item" onclick="app.showPropertiesById('${assetIdAttr}', 'view')">
                    <i class="fas fa-info-circle"></i> Properties
                </div>
            `);
        } else {
            dropdownItems.push(`
                <div class="card-dropdown-item" onclick="app.showProperties(${index}, '${ownershipContext}')">
                    <i class="fas fa-info-circle"></i> Properties
                </div>
            `);
        }

        if (isCollection && hasScid) {
            dropdownItems.push(`
                <div class="card-dropdown-item" onclick="app.viewCollectionNFTs('${scidAttr}')">
                    <i class="fas fa-eye"></i> View Collection
                </div>
                <div class="card-dropdown-item" onclick="app.addCollectionToWallet('${scidAttr}')">
                    <i class="fas fa-wallet"></i> Add to Wallet${this.savedAssets && this.savedAssets.some(a => a.scid === scidAttr || a.collection_scid === scidAttr) ? ' <i class="fas fa-check" style="color: green; margin-left: 5px;"></i>' : ''}
                </div>
                <div class="card-dropdown-item" onclick="app.scanCollectionForWallet('${scidAttr}')">
                    <i class="fas fa-search"></i> Scan Collection
                </div>
            `);
        } else {
            if (context !== 'view') {
                // Check if asset is already saved
                const isSaved = this.savedAssets && this.savedAssets.some(a => a.id === assetIdAttr || a.scid === scidAttr);
                dropdownItems.push(`
                    <div class="card-dropdown-item" onclick="app.addToWallet('${assetIdAttr}', '${item.type || 'NFT'}', '${scidAttr}', '${tokenAttr}')">
                        <i class="fas fa-wallet"></i> Add to Wallet${isSaved ? ' <i class="fas fa-check" style="color: green; margin-left: 5px;"></i>' : ''}
                    </div>
                `);
            }
            if (hasScid) {
                // Only show Display/Retrieve for NFT assets (G45 standard), not NFA assets (ART-NFA-MS1)
                // NFA assets don't have DisplayToken/RetrieveToken functions - they use Start/CancelListing/CloseListing
                const isNFA = this.isArtificerAsset && this.isArtificerAsset(item);
                if (!isNFA) {
                    dropdownItems.push(`
                        <div class="card-dropdown-item" onclick="app.displayNFT('${scidAttr}', '${tokenAttr}')">
                            <i class="fas fa-eye"></i> Display
                        </div>
                        <div class="card-dropdown-item" onclick="app.retrieveNFTPrompt('${scidAttr}', '${tokenAttr}')">
                            <i class="fas fa-download"></i> Retrieve
                        </div>
                    `);
                }
                if (context === 'view') {
                    // For NFAs, show cancel/close listing option
                    if (isNFA) {
                        dropdownItems.push(`
                            <div class="card-dropdown-item" onclick="app.createSellOrderForAsset('${scidAttr}', '${tokenAttr}', '${safeName}')">
                                <i class="fas fa-tag"></i> Create Sell Order
                            </div>
                            <div class="card-dropdown-item" onclick="app.cancelNFAListing('${scidAttr}')">
                                <i class="fas fa-times-circle"></i> Cancel/Close Listing
                            </div>
                        `);
                    } else {
                        dropdownItems.push(`
                            <div class="card-dropdown-item" onclick="app.createSellOrderForAsset('${scidAttr}', '${tokenAttr}', '${safeName}')">
                                <i class="fas fa-tag"></i> Create Sell Order
                            </div>
                            <div class="card-dropdown-item" onclick="app.createBuyOrderForAsset('${scidAttr}', '${tokenAttr}', '${safeName}')">
                                <i class="fas fa-shopping-cart"></i> Create Buy Order
                            </div>
                            <div class="card-dropdown-item" onclick="app.closeOrdersForAsset('${scidAttr}', '${tokenAttr}')">
                                <i class="fas fa-times-circle"></i> Close Orders
                            </div>
                        `);
                    }
                } else {
                    dropdownItems.push(`
                        <div class="card-dropdown-item" onclick="app.createSellOrderFromSearch(${index})">
                            <i class="fas fa-tag"></i> Create Sell Order
                        </div>
                        <div class="card-dropdown-item" onclick="app.createBuyOrderFromSearch(${index})">
                            <i class="fas fa-shopping-cart"></i> Create Buy Order
                        </div>
                        <div class="card-dropdown-item" onclick="app.closeOrdersFromSearch(${index})">
                            <i class="fas fa-times-circle"></i> Close Orders
                        </div>
                    `);
                }
            }

            if (context === 'view') {
                dropdownItems.push(`
                    <div class="card-dropdown-item" data-action="check-ownership" data-asset-id="${assetDomAttr}" onclick="app.checkOwnershipById('${assetIdAttr}')">
                        <i class="fas fa-check-circle"></i> Check Ownership
                        <span class="action-spinner"><i class="fas fa-circle-notch fa-spin"></i></span>
                    </div>
                `);
            } else {
                dropdownItems.push(`
                    <div class="card-dropdown-item" data-action="check-ownership" data-asset-id="${assetDomAttr}" onclick="app.checkOwnership(${index}, '${ownershipContext}')">
                        <i class="fas fa-check-circle"></i> Check Ownership
                        <span class="action-spinner"><i class="fas fa-circle-notch fa-spin"></i></span>
                    </div>
                `);
            }
        }

        if (context === 'view') {
            dropdownItems.push(`
                    <div class="card-dropdown-item" onclick="app.removeAssetFromWallet('${assetIdAttr}')">
                    <i class="fas fa-trash"></i> Remove from Wallet
                </div>
            `);
        }

        const dropdownHtml = `
            <div class="card-dropdown">
                <button class="card-dropdown-btn" onclick="app.toggleDropdown('${dropdownId}')">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="card-dropdown-menu" id="${dropdownId}" style="z-index: 9999;">
                    ${dropdownItems.join('')}
                </div>
            </div>
        `;

        // Removed badgesHtml - status is only shown in top banner (top left)
        const orderInfoHtml = context === 'view' ? `<div class="asset-orders">${this.getAssetOrderInfo(item)}</div>` : '';
        const imageWrapperClass = `search-result-image-wrapper${(isCollection && item.scid) ? ' clickable' : ''}`;
        const collectionClickAttr = (isCollection && item.scid)
            ? `onclick="app.handleCollectionCardClick(event, '${scidAttr}')"`
            : '';

        return `
            <div class="search-result-card" id="${cardId}" data-asset-id="${assetDomAttr}" data-name="${safeName}" data-collection="${collectionLabel}" data-date="${dateAttr}" data-price="${priceAttr}" ${collectionClickAttr}>
                <div class="search-result-top-banner">
                    <div class="search-result-status ${status.className}">${status.text}</div>
                    ${dropdownHtml}
                </div>
                <div class="${imageWrapperClass}">
                    <img src="${imageSrc}" alt="${safeName}" class="search-result-image" onerror="this.style.display='none'">
                </div>
                <div class="search-result-bottom-banner">
                    <div class="search-result-name" title="${safeName}">${safeName}</div>
                    <div class="search-result-type">${normalizedType}${item.tokenId && !isCollection ? ` #${item.tokenId}` : ''}</div>
                </div>
                ${orderInfoHtml}
            </div>
        `;
    }

    DeroNFTApp.prototype.renderSearchResults = function(results) {
        try {
            const container = document.getElementById('searchResults');
            if (!container || !Array.isArray(results)) {
                return;
            }

            // Search tab only displays asset data (name, image, type, etc.)
            // Ownership status is determined manually via "Check Ownership" button
            // No ownership syncing needed here

            if (results.length === 0) {
                container.innerHTML = '<div class="text-center mt-20">No results found. Try searching by SCID, token ID, or collection name.</div>';
                this.lastSearchResults = [];
                return;
            }

            try {
                // Validate results before rendering
                const validResults = results.filter(item => {
                    if (!item) return false;
                    if (!item.scid && !item.id) return false;
                    return true;
                });
                
                if (validResults.length === 0 && results.length > 0) {
                    container.innerHTML = '<div class="text-center mt-20">No valid results to display.</div>';
                    return;
                }
                
                container.innerHTML = validResults.map((item, index) => {
                    try {
                        if (!this.renderAssetCard || !item || (!item.scid && !item.id)) {
                            return '';
                        }
                        return this.renderAssetCard(item, index, 'search') || '';
                    } catch (cardError) {
                        return '';
                    }
                }).filter(Boolean).join('');
                
                // Only update lastSearchResults if rendering succeeded
                this.lastSearchResults = validResults;
            } catch (renderError) {
                try {
                    container.innerHTML = '<div class="text-center mt-20">Error rendering results. Please try again.</div>';
                } catch (innerError) {
                    // Ignore
                }
            }
        } catch (error) {
            // Ignore
        }
    }

    DeroNFTApp.prototype.handleCollectionCardClick = function(event, scid) {
        if (!scid) return;
        if (event.target.closest('.card-dropdown')) {
            return;
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        this.viewCollectionNFTs(scid);
    }

    DeroNFTApp.prototype.getCollectionAssets = function(scid, collectionName = '') {
        const results = [];
        const seen = new Set();
        const normalizedScid = (scid || '').toLowerCase();
        const normalizedName = (collectionName || '').toLowerCase();

        const consider = (asset) => {
            if (!asset) return;
            const assetId = (asset.id || `${asset.scid || ''}_${asset.tokenId || ''}`).toLowerCase();
            if (!assetId || seen.has(assetId)) {
                return;
            }
            const assetScid = (asset.scid || '').toLowerCase();
            const assetCollectionScid = (asset.collection_scid || '').toLowerCase();
            const assetCollectionName = (asset.collection_name || '').toLowerCase();
            const matchesScid = normalizedScid && (assetCollectionScid === normalizedScid || assetScid === normalizedScid);
            const matchesName = normalizedName && assetCollectionName === normalizedName;
            if (matchesScid || matchesName) {
                seen.add(assetId);
                results.push(asset);
            }
        };

        const addFromSource = (source) => {
            if (Array.isArray(source)) {
                source.forEach(consider);
            } else if (source?.nfts && Array.isArray(source.nfts)) {
                source.nfts.forEach(consider);
            }
        };

        addFromSource(this.savedAssets);
        addFromSource(this.assetsCache?.value);
        addFromSource(this.lastSearchResults);
        addFromSource(this.lastCollectionResults);

        return results;
    }

    DeroNFTApp.prototype.removeAssetFromWallet = function(assetId) {
        // Simple, safe remove function - no crashes
        try {
            if (!assetId) return;

            const targetId = String(assetId).toLowerCase();
            const beforeCount = Array.isArray(this.savedAssets) ? this.savedAssets.length : 0;
            
            // Remove from savedAssets
            if (Array.isArray(this.savedAssets)) {
                this.savedAssets = this.savedAssets.filter(asset => {
                    if (!asset) return true;
                    const assetId = (asset.id || '').toLowerCase();
                    return assetId !== targetId;
                });
            }

            if (beforeCount === this.savedAssets.length) return;

            // Save to localStorage
            try {
                if (this.saveAssets && typeof this.saveAssets === 'function') {
                    this.saveAssets();
                } else if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('ored_saved_assets', JSON.stringify(this.savedAssets || []));
                }
            } catch (e) {
                // Ignore save errors
            }

            // Prune from cache
            const pruneList = (list) => {
                if (!Array.isArray(list)) return list;
                return list.filter(asset => {
                    if (!asset) return true;
                    const assetId = (asset.id || '').toLowerCase();
                    return assetId !== targetId;
                });
            };

            try {
                if (this.assetsCache && this.assetsCache.value) {
                    if (Array.isArray(this.assetsCache.value)) {
                        this.assetsCache.value = pruneList(this.assetsCache.value);
                    } else if (this.assetsCache.value.nfts && Array.isArray(this.assetsCache.value.nfts)) {
                        this.assetsCache.value.nfts = pruneList(this.assetsCache.value.nfts);
                    }
                    this.assetsCache.timestamp = Date.now();
                }
            } catch (e) {
                // Ignore cache errors
            }

            // Prune from search results
            try {
                if (Array.isArray(this.lastSearchResults)) {
                    this.lastSearchResults = pruneList(this.lastSearchResults);
                }
                if (Array.isArray(this.lastCollectionResults)) {
                    this.lastCollectionResults = pruneList(this.lastCollectionResults);
                }
            } catch (e) {
                // Ignore prune errors
            }

            // Update UI - simple DOM update, no full re-render
            try {
                if (this.currentTab === 'view') {
                    // Remove the card from DOM directly
                    const assetDomKey = this.getAssetDomKey ? this.getAssetDomKey({ id: assetId }) : null;
                    if (assetDomKey) {
                        const cardElement = document.querySelector(`[data-asset-id="${assetDomKey}"]`);
                        if (cardElement && cardElement.parentNode) {
                            cardElement.parentNode.removeChild(cardElement);
                        }
                    }
                    
                    // Also try to re-render if renderAssetsWithOrders exists
                    if (this.renderAssetsWithOrders && this.assetsCache && this.assetsCache.value) {
                        this.renderAssetsWithOrders(this.assetsCache.value);
                    }
                }
            } catch (e) {
                // Ignore UI update errors
            }

            // Show notification (but don't crash if it fails)
            try {
                if (this.showNotification && typeof this.showNotification === 'function') {
                    this.showNotification('Asset removed from wallet view', 'info');
                }
            } catch (e) {
                // Ignore notification errors
            }
        } catch (error) {
            // Ignore
        }
    }

    DeroNFTApp.prototype.renderCollectionSearchResults = function(scid, results) {
        const container = document.getElementById('searchResults');
        
        // Reuse the standard renderSearchResults for simplicity
        // This ensures consistent formatting and dropdown menus
        this.renderSearchResults(results);
    }


    DeroNFTApp.prototype.addToWallet = async function(assetId, assetType, scid, tokenId) {
        try {
            if (!this.currentAddress) {
                this.showNotification('Asset will be saved locally. Connect your wallet later to sync on-chain ownership.', 'info');
            }
            let assetsToAdd = [];

            // If we have scid and tokenId, create asset object
            if (scid && tokenId) {
                const baseAsset = {
                    id: `${scid}_${tokenId}`,
                    scid: scid,
                    tokenId: tokenId,
                    type: assetType || 'NFT',
                    image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                    description: `Token ID: ${tokenId} from collection ${scid.substring(0, 8)}...`,
                    collection_name: 'My NFT Collection',
                    collection_scid: scid,
                    addedManually: true,
                    addedAt: new Date().toISOString(),
                    owned: true
                };

                const enriched = this.enrichAssetWithG45 ? await this.enrichAssetWithG45(baseAsset) : baseAsset;
                if (this.classifyAssetType) {
                    enriched.type = this.classifyAssetType(enriched.contractType, enriched.type, enriched.isCollection);
                }
                assetsToAdd = [enriched || baseAsset];
            } else if (assetId.length === 64 && /^[0-9a-fA-F]+$/.test(assetId)) {
                // This is a SCID - try to fetch metadata but do not require ownership
                const directAsset = await this.queryG45AT ? await this.queryG45AT(assetId) : null;
                if (directAsset) {
                    assetsToAdd = [{
                        ...directAsset,
                        id: directAsset.id || assetId,
                        scid: directAsset.scid || assetId,
                        collection_scid: directAsset.collection_scid || assetId,
                        addedManually: true,
                        addedAt: new Date().toISOString(),
                        owned: true
                    }];
                    if (this.classifyAssetType && assetsToAdd[0]) {
                        assetsToAdd[0].type = this.classifyAssetType(assetsToAdd[0].contractType, assetsToAdd[0].type, assetsToAdd[0].isCollection);
                    }
                } else {
                    assetsToAdd = [{
                        id: assetId,
                        scid: assetId,
                        name: `Asset ${assetId.substring(0, 8)}...`,
                        type: assetType || 'NFT',
                        image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                        description: 'Saved asset reference',
                        collection_scid: assetId,
                        addedManually: true,
                        addedAt: new Date().toISOString(),
                        owned: true
                    }];
                    if (this.classifyAssetType) {
                        assetsToAdd[0].type = this.classifyAssetType(assetsToAdd[0].contractType, assetsToAdd[0].type, assetsToAdd[0].isCollection);
                    }
                }
            } else {
                // Basic asset info
                const asset = {
                    id: assetId,
                    name: `Asset ${assetId.substring(0, 8)}...`,
                    type: assetType || 'NFT',
                    image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                    description: 'Manually added asset',
                    addedManually: true,
                    addedAt: new Date().toISOString(),
                    owned: true
                };
                if (this.classifyAssetType) {
                    asset.type = this.classifyAssetType(asset.contractType, asset.type, asset.isCollection);
                }
                assetsToAdd = [asset];
            }

            if (assetsToAdd.length > 0) {
                // Add to saved assets (persistent storage)
                const existingIds = new Set(this.savedAssets.map(a => a.id));
                const newAssets = assetsToAdd.filter(a => !existingIds.has(a.id));
                
                if (newAssets.length > 0) {
                    this.savedAssets.push(...newAssets);
                    this.saveAssets();
                    
                    
                    // Also add to current cache
                    if (!this.assetsCache || !this.assetsCache.value) {
                        this.assetsCache = {
                            value: {
                                nfts: [],
                                nfas: [],
                                orders: []
                            },
                            timestamp: Date.now()
                        };
                    }
                    let cacheList;
                    if (Array.isArray(this.assetsCache.value)) {
                        cacheList = this.assetsCache.value;
                    } else {
                        if (!this.assetsCache.value.nfts) {
                            this.assetsCache.value.nfts = [];
                        }
                        cacheList = this.assetsCache.value.nfts;
                    }
                    cacheList.push(...newAssets);
                    // Remove duplicates
                    const deduped = [...new Map(cacheList.map(nft => [nft.id, nft])).values()];
                    if (Array.isArray(this.assetsCache.value)) {
                        this.assetsCache.value = deduped;
                    } else {
                        this.assetsCache.value.nfts = deduped;
                    }
                    
                    this.showSuccess(`Added ${newAssets.length} asset(s) to wallet view`);
                    
                    // Don't switch tabs - stay in current tab
                    // Refresh current view if on view tab
                    if (this.currentTab === 'view') {
                        this.renderAssetsWithOrders(this.assetsCache.value);
                    } else if (this.currentTab === 'search') {
                        // Refresh search results to show checkmark
                        this.renderSearchResults(this.lastSearchResults || []);
                    }
                } else {
                    this.showError('Asset(s) already in wallet view');
                }
            }
        } catch (error) {
            this.showError(`Failed to add to wallet: ${error.message}`);
        }
    }

    DeroNFTApp.prototype.addCollectionToWallet = async function(scid) {
        this.showLoading('loadingSearch');
        
        try {
            if (!this.currentAddress) {
                this.showNotification('Collection will be saved locally. Connect your wallet later to sync on-chain ownership.', 'info');
            }
            
            const normalizedScid = scid.toLowerCase().trim();
            
            // Query collection metadata
            const g45Asset = this.queryG45AT ? await this.queryG45AT(normalizedScid) : null;
            const collectionAsset = g45Asset ? {
                ...g45Asset,
                id: g45Asset.id || normalizedScid,
                scid: g45Asset.scid || normalizedScid,
                addedManually: true,
                addedAt: new Date().toISOString(),
                owned: true
            } : {
                id: normalizedScid,
                scid: normalizedScid,
                name: `Collection ${normalizedScid.substring(0, 8)}...`,
                type: 'Collection',
                image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                description: 'Saved collection reference',
                addedManually: true,
                addedAt: new Date().toISOString(),
                isCollection: true,
                owned: true
            };

            collectionAsset.collection_scid = normalizedScid;
            if (!collectionAsset.collection_name) {
                collectionAsset.collection_name = collectionAsset.name;
            }
            collectionAsset.type = this.classifyAssetType
                ? this.classifyAssetType(collectionAsset.contractType || 'G45-C', collectionAsset.type, true)
                : (collectionAsset.type || 'Collection');
            
            const existingIds = new Set(this.savedAssets.map(a => a.id?.toLowerCase()));
            if (existingIds.has(collectionAsset.id?.toLowerCase())) {
                this.showError('This collection is already in wallet view');
                return;
            }
            
            // Load all NFTs in the collection from on-chain data (but don't save them individually)
            let collectionNFTs = [];
            try {
                // First try queryAllCollectionNFTs (handles both token-based and single-SCID collections)
                if (this.queryAllCollectionNFTs) {
                    collectionNFTs = await this.queryAllCollectionNFTs(normalizedScid);
                }
                // If that didn't work, try loadCollectionFromChain
                if ((!collectionNFTs || collectionNFTs.length === 0) && this.loadCollectionFromChain) {
                    collectionNFTs = await this.loadCollectionFromChain(normalizedScid);
                }
                
                // Ensure all NFTs have collection_scid set
                collectionNFTs = collectionNFTs.map(nft => ({
                    ...nft,
                    collection_scid: normalizedScid,
                    collection_name: collectionAsset.collection_name || collectionAsset.name
                }));
            } catch (error) {
                // Continue anyway - save collection even if NFTs fail to load
            }
            
            // Store NFTs in the collection asset (not as separate saved assets)
            collectionAsset.collectionNFTs = collectionNFTs;
            collectionAsset._hasLoadedNFTs = true; // Flag to indicate NFTs have been loaded
            
            // Only save the collection asset itself, not individual NFTs
            if (!existingIds.has(collectionAsset.id?.toLowerCase())) {
            this.savedAssets.push(collectionAsset);
            this.saveAssets();
            
            if (!this.assetsCache || !this.assetsCache.value) {
                this.assetsCache = {
                    value: {
                        nfts: [],
                        nfas: [],
                        orders: []
                    },
                    timestamp: Date.now()
                };
            }
            let cacheList;
            if (Array.isArray(this.assetsCache.value)) {
                cacheList = this.assetsCache.value;
            } else {
                if (!this.assetsCache.value.nfts) {
                    this.assetsCache.value.nfts = [];
                }
                cacheList = this.assetsCache.value.nfts;
            }
            cacheList.push(collectionAsset);
                const deduped = [...new Map(cacheList.map(nft => [nft.id?.toLowerCase() || nft.scid?.toLowerCase(), nft])).values()];
            if (Array.isArray(this.assetsCache.value)) {
                this.assetsCache.value = deduped;
            } else {
                this.assetsCache.value.nfts = deduped;
            }
            
                const nftCount = collectionNFTs.length;
                this.showSuccess(`Collection saved with ${nftCount} NFT${nftCount !== 1 ? 's' : ''} loaded. Click the collection to view and save individual NFTs.`);
            } else {
                this.showError('This collection is already in wallet view');
                return;
            }
            
            // Don't switch tabs - stay in current tab
            if (this.currentTab === 'view') {
                this.renderAssetsWithOrders(this.assetsCache.value);
            } else if (this.currentTab === 'search') {
                // Refresh search results to show checkmark
                this.renderSearchResults(this.lastSearchResults || []);
            }
        } catch (error) {
            this.showError(`Failed to add collection: ${error.message}`);
        } finally {
            this.hideLoading('loadingSearch');
        }
    }

    DeroNFTApp.prototype.switchTab = async function(tabName) {
        try {
            // Update tab buttons
            const allTabBtns = document.querySelectorAll('.tab-btn');
            allTabBtns.forEach(btn => btn.classList.remove('active'));
            
            const activeTabBtn = document.querySelector(`[data-tab="${tabName}"]`);
            if (activeTabBtn) {
                activeTabBtn.classList.add('active');
            }

            // Update tab content
            const allTabContent = document.querySelectorAll('.tab-content');
            allTabContent.forEach(content => content.classList.remove('active'));
            
            const activeTabContent = document.getElementById(`${tabName}-tab`);
            if (activeTabContent) {
                activeTabContent.classList.add('active');
            }
        } catch (error) {
            // Ignore DOM update errors
        }

        // Store current tab for state management
        this.currentTab = tabName;

        // Load data for the active tab with proper error handling
        try {
            if (tabName === 'view' && this.currentAddress) {
                // Use cached assets if available - NEVER refresh on tab switch to avoid GetTransfers requests
                // Users can manually refresh if needed
                const hasCachedAssets = this.assetsCache.value && (Array.isArray(this.assetsCache.value) ? this.assetsCache.value.length > 0 : (this.assetsCache.value.nfts && this.assetsCache.value.nfts.length > 0));
                if (hasCachedAssets) {
                    this.renderAssetsWithOrders(this.assetsCache.value);
                } else {
                    // Hydrate from saved assets first
                    const savedNFTs = Array.isArray(this.savedAssets) ? this.savedAssets : [];
                    let uniqueNFTs = savedNFTs.length > 0 ? [...new Map(savedNFTs.map(nft => [nft.id || nft.scid, nft])).values()] : [];
                    
                    // If still nothing and transfers cached, parse transfers
                    if (uniqueNFTs.length === 0 && this.transfersCache?.value) {
                        const parsedAssets = await this.parseAssetsFromTransfers(this.transfersCache.value);
                        const allNFTs = [...(parsedAssets || [])];
                        uniqueNFTs = [...new Map(allNFTs.map(nft => [nft.id || nft.scid, nft])).values()];
                    }
                    
                    const assetData = {
                        nfts: uniqueNFTs,
                        nfas: [],
                        orders: []
                    };
                    this.assetsCache = { value: assetData, timestamp: Date.now() };
                    this.assets = assetData;
                    this.renderAssetsWithOrders(assetData);
                }
            } else if (tabName === 'view' && !this.currentAddress) {
                // Not connected - still show saved assets
                // Make sure savedAssets is loaded from localStorage
                if (!Array.isArray(this.savedAssets) || this.savedAssets.length === 0) {
                    if (this.loadSavedAssets) {
                        this.savedAssets = this.loadSavedAssets();
                    }
                }
                const savedNFTs = Array.isArray(this.savedAssets) ? this.savedAssets : [];
                if (savedNFTs.length > 0) {
                    const assetData = {
                        nfts: savedNFTs,
                        nfas: [],
                        orders: []
                    };
                    this.assetsCache = { value: assetData, timestamp: Date.now() };
                    this.renderAssetsWithOrders(assetData);
                } else {
                    // Even if empty, prime the cache so it's ready
                    if (this.primeCachedAssetsFromSaved) {
                        this.primeCachedAssetsFromSaved(false);
                    }
                }
            } else if (tabName === 'send' && this.currentAddress) {
                // Ensure fromAddress is populated
                const fromAddressField = document.getElementById('fromAddress');
                if (fromAddressField && !fromAddressField.value) {
                    fromAddressField.value = this.currentAddress;
                }
            } else if (tabName === 'search' && this.currentAddress) {
                // No need to reload stats or assets - caching handles this
                // Search tab doesn't need GetTransfers permission
            } else if (tabName === 'sell' && this.currentAddress) {
                this.loadSellOrders();
            } else if (tabName === 'buy' && this.currentAddress) {
                this.loadBuyOrders();
            } else if (tabName === 'token-trading' && this.currentAddress) {
                // Load saved tokens when token trading tab is opened
                this.loadSavedTokensForDisplay();
            } else if (tabName === 'wallet-calls') {
                // Engram XSWD Test Tool tab - no action needed, just show the tab
                // Status will be updated automatically by the test tool scripts
            } else if (!this.currentAddress) {
                // Show connection prompt for tabs that require wallet
                if (['view', 'send', 'search', 'sell', 'buy'].includes(tabName)) {
                    this.showError('Please connect your wallet first');
                }
            }
        } catch (error) {
            this.showError(`Failed to load ${tabName} tab: ${error.message}`);
        }
    }

    DeroNFTApp.prototype.updateCollectionFilterOptions = function(assetList = []) {
        const filter = document.getElementById('collectionFilter');
        if (!filter) return;

        const previousValue = filter.value;
        const entries = new Map();

        assetList.forEach(asset => {
            if (!asset) return;
            const scid = (asset.collection_scid || (asset.isCollection ? asset.scid : '') || '').toLowerCase();
            if (!scid) return;
            const label = asset.collection_name || asset.name || `${scid.substring(0, 8)}...`;
            if (!entries.has(scid)) {
                entries.set(scid, label);
            }
        });

        let optionsHtml = '<option value="">All Collections</option>';
        entries.forEach((label, scid) => {
            optionsHtml += `<option value="${scid}">${label}</option>`;
        });

        filter.innerHTML = optionsHtml;
        if (previousValue && entries.has(previousValue)) {
            filter.value = previousValue;
        }
    }


    DeroNFTApp.prototype.getAssetOrderInfo = function(asset) {
        // Check if asset is in any orders
        const inSellOrders = this.checkAssetInOrders(asset, 'sell');
        const inBuyOrders = this.checkAssetInOrders(asset, 'buy');
        
        if (inSellOrders || inBuyOrders) {
            return `
                <div class="order-status-info">
                    <span class="order-badge sell">${inSellOrders ? 'In Sell Order' : ''}</span>
                    <span class="order-badge buy">${inBuyOrders ? 'In Buy Order' : ''}</span>
                </div>
            `;
        }
        return '<div class="order-status-info"><span class="order-badge none">No Orders</span></div>';
    }

    DeroNFTApp.prototype.checkAssetInOrders = function(asset, orderType) {
        if (!this.currentAddress || !asset) {
            return false;
        }
        const assetId = asset.id || asset.scid || '';
        if (!assetId) {
            return false;
        }
        const ordersKey = `ored_${orderType}_orders_${this.currentAddress}`;
        const orders = JSON.parse(localStorage.getItem(ordersKey) || '[]');
        if (!orders || orders.length === 0) {
            return false;
        }
        const identifiers = this.splitAssetIdentifier ? this.splitAssetIdentifier(assetId) : { scid: asset.scid, tokenId: asset.tokenId };
        const scid = identifiers.scid || asset.scid;
        const tokenId = identifiers.tokenId || asset.tokenId;
        return orders.some(order => this.orderMatchesAsset && this.orderMatchesAsset(order, scid, tokenId));
    }


    // Find asset by SCID in various caches
    DeroNFTApp.prototype.findAssetByScid = function(scid) {
        if (!scid) return null;
        const target = scid.toLowerCase();
        const sources = [];
        if (Array.isArray(this.savedAssets)) {
            sources.push(this.savedAssets);
        }
        const cacheValue = this.assetsCache?.value;
        if (Array.isArray(cacheValue)) {
            sources.push(cacheValue);
        } else if (cacheValue && Array.isArray(cacheValue.nfts)) {
            sources.push(cacheValue.nfts);
        }
        if (Array.isArray(this.lastSearchResults)) {
            sources.push(this.lastSearchResults);
        }
        if (Array.isArray(this.lastCollectionResults)) {
            sources.push(this.lastCollectionResults);
        }
        for (const list of sources) {
            for (const asset of list) {
                if (asset && (asset.scid || '').toLowerCase() === target) {
                    return asset;
                }
            }
        }
        return null;
    };

    // Find asset by ID in various caches
    DeroNFTApp.prototype.findAssetById = function(assetId) {
        if (!assetId) return null;
        const target = assetId.toLowerCase();

        const sources = [
            this.lastSearchResults,
            this.lastCollectionResults,
            this.savedAssets,
            Array.isArray(this.assetsCache?.value) ? this.assetsCache.value : this.assetsCache?.value?.nfts,
            this.assetsCache?.value?.nfts
        ];

        for (const list of sources) {
            if (!Array.isArray(list)) continue;
            const found = list.find(item => item && item.id && item.id.toLowerCase() === target);
            if (found) return found;
        }
        return null;
    };

    // Dropdown menu management
    DeroNFTApp.prototype.closeAllDropdowns = function(exceptId = null) {
        document.querySelectorAll('.card-dropdown-menu').forEach(menu => {
            if (exceptId && menu.id === exceptId) {
                return;
            }
            menu.classList.remove('active');
            const parentCard = menu.closest('.search-result-card');
            if (parentCard) {
                parentCard.classList.remove('dropdown-open');
            }
        });
        if (!exceptId) {
            this.activeDropdownId = null;
        }
    };

    DeroNFTApp.prototype.toggleDropdown = function(dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        const wasActive = dropdown.classList.contains('active');
        this.closeAllDropdowns();
        if (!wasActive) {
            dropdown.classList.add('active');
            const parentCard = dropdown.closest('.search-result-card');
            if (parentCard) {
                parentCard.classList.add('dropdown-open');
            }
            this.activeDropdownId = dropdownId;
        } else {
            this.activeDropdownId = null;
        }
    };

    // Properties modal functions
    DeroNFTApp.prototype.showProperties = function(indexOrId, context = 'search') {
        let asset = null;

        if (context === 'view' && typeof indexOrId === 'string') {
            asset = this.findAssetById(indexOrId);
        } else {
            const sourceLists = {
                search: this.lastSearchResults,
                collection: this.lastCollectionResults
            };
            const list = sourceLists[context] || [];
            asset = list[indexOrId];
        }

        if (!asset) {
            this.showError('Asset details not available yet');
            return;
        }

        const rows = [
            { label: 'Name', value: asset.name },
            { label: 'Type', value: asset.type || (asset.isCollection ? 'Collection' : 'NFT') },
            { label: 'SCID', value: asset.scid },
            { label: 'Token ID', value: asset.tokenId },
            { label: 'Asset ID', value: asset.id },
            { label: 'Collection', value: asset.collection_name },
            { label: 'Collection SCID', value: asset.collection_scid },
            { label: 'Owner', value: asset.owner },
            { label: 'Minter', value: asset.minter },
            { label: 'Contract Type', value: asset.contractType },
            { label: 'Description', value: asset.description }
        ].filter(row => row.value);

        const attributesHtml = asset.attributes ? `
            <div class="property-section">
                <h4>Attributes</h4>
                <div class="property-grid">
                    ${Object.entries(asset.attributes).map(([key, value]) => `
                        <div class="property-row">
                            <span class="property-label">${key}</span>
                            <span class="property-value">${value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';

        const escapeHtml = (value) => {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        };

        const metadataHtml = asset.metadata ? `
            <div class="property-section">
                <h4>Metadata</h4>
                <pre class="metadata-block">${escapeHtml(
                    typeof asset.metadata === 'string'
                        ? asset.metadata
                        : JSON.stringify(asset.metadata, null, 2)
                )}</pre>
            </div>
        ` : '';

        const detailsHtml = rows.length > 0 ? `
            <div class="property-section">
                <h4>Details</h4>
                <div class="property-grid">
                    ${rows.map(row => `
                        <div class="property-row">
                            <span class="property-label">${row.label}</span>
                            <span class="property-value">${row.value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';

        const modalHtml = `
            <div class="modal active" id="propertiesModal" onclick="if(event.target.id === 'propertiesModal') app.hideProperties()">
                <div class="modal-content" style="max-width: 720px; max-height: 90vh; overflow-y: auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <h2 style="margin:0;">${asset.name || 'Asset Properties'}</h2>
                        <button class="btn btn-secondary" onclick="app.hideProperties()">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                    ${asset.image ? `
                        <div style="text-align:center;margin-bottom:20px;">
                            <img src="${asset.image}" alt="${asset.name || 'Asset'}" style="max-width:100%;max-height:280px;border-radius:12px;" onerror="this.style.display='none'">
                        </div>
                    ` : ''}
                    ${detailsHtml}
                    ${attributesHtml}
                    ${metadataHtml}
                </div>
            </div>
        `;

        const existing = document.getElementById('propertiesModal');
        if (existing) {
            existing.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    DeroNFTApp.prototype.showPropertiesById = function(assetId, context = 'view') {
        this.showProperties(assetId, context);
    };

    DeroNFTApp.prototype.hideProperties = function() {
        const modal = document.getElementById('propertiesModal');
        if (modal) {
            modal.remove();
        }
    };


    DeroNFTApp.prototype.applyAssetFilters = function(assetList = []) {
        const collectionFilterEl = document.getElementById('collectionFilter');
        const typeFilterEl = document.getElementById('typeFilter');
        const collectionFilter = collectionFilterEl ? collectionFilterEl.value.toLowerCase() : '';
        const typeFilter = typeFilterEl ? typeFilterEl.value.toUpperCase() : '';

        if (!collectionFilter && !typeFilter) {
            return assetList;
        }

        return assetList.filter(asset => {
            if (!asset) return false;

            const assetCollection = (asset.collection_scid || (asset.isCollection ? asset.scid : '') || '').toLowerCase();
            if (collectionFilter && assetCollection !== collectionFilter) {
                return false;
            }

            if (typeFilter) {
                const normalizedType = this.classifyAssetType
                    ? this.classifyAssetType(asset.contractType, asset.type, asset.isCollection)
                    : (asset.isCollection ? 'Collection' : (asset.type || 'NFT'));

                if (typeFilter === 'COLLECTION' && normalizedType !== 'Collection') {
                    return false;
                }
                if (typeFilter === 'NFT' && normalizedType !== 'NFT') {
                    return false;
                }
                if (typeFilter === 'NFA' && normalizedType !== 'NFA') {
                    return false;
                }
            }

            return true;
        });
    };

    DeroNFTApp.prototype.renderAssetsWithOrders = function(assets) {
        const container = document.getElementById('assetsGrid');
        if (!container) {
            return;
        }
        const assetList = Array.isArray(assets)
            ? assets
            : (assets && Array.isArray(assets.nfts) ? assets.nfts : []);

        this.updateCollectionFilterOptions?.(assetList || []);
        const filteredAssets = this.applyAssetFilters ? this.applyAssetFilters(assetList || []) : (assetList || []);

        if (!filteredAssets || filteredAssets.length === 0) {
            container.innerHTML = '<div class="text-center mt-20">No assets saved yet. Use "Add to Wallet" on a search result to pin it here.</div>';
            return;
        }

        container.innerHTML = '';
        setTimeout(() => {
            container.innerHTML = filteredAssets.map((asset, idx) => this.renderAssetCard(asset, idx, 'view')).join('');
        }, 50);
    };

    DeroNFTApp.prototype.getAssetDisplayName = function(scid, tokenId) {
        if (tokenId !== undefined && tokenId !== null && tokenId !== '') {
            return `NFT #${tokenId}`;
        }
        const lowerScid = (scid || '').toLowerCase();
        const saved = (this.savedAssets || []).find(asset => (asset.scid || '').toLowerCase() === lowerScid);
        if (saved && saved.name) {
            return saved.name;
        }
        const searchSources = [this.lastSearchResults, this.lastCollectionResults];
        for (const source of searchSources) {
            if (Array.isArray(source)) {
                const match = source.find(asset => (asset.scid || '').toLowerCase() === lowerScid);
                if (match && match.name) {
                    return match.name;
                }
            }
        }
        if (scid) {
            return `Asset ${scid.substring(0, 8)}...`;
        }
        return 'NFT';
    };


    DeroNFTApp.prototype.deroToAtomic = function(amount) {
        const value = parseFloat(amount);
        if (Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
            return 0;
        }
        return Math.round(value * 100000);
    };

    DeroNFTApp.prototype.atomicToDero = function(amount) {
        const numeric = typeof amount === 'number' ? amount : parseInt(amount, 10) || 0;
        return numeric / 100000;
    };

    DeroNFTApp.prototype.getAssetDomKey = function(assetOrId) {
        let key = '';
        if (assetOrId && typeof assetOrId === 'object') {
            key = assetOrId.id
                || (assetOrId.scid && assetOrId.tokenId ? `${assetOrId.scid}_${assetOrId.tokenId}` : assetOrId.scid)
                || assetOrId.assetId;
        } else {
            key = assetOrId;
        }
        if (!key) return '';
        return String(key).replace(/[^0-9a-zA-Z_-]/g, '_');
    };

    DeroNFTApp.prototype.setActionLoading = function(asset, actionKey, isLoading) {
        if (!actionKey || typeof document === 'undefined') return;
        const domKey = this.getAssetDomKey(asset);
        if (!domKey) return;
        const selector = `.card-dropdown-item[data-action="${actionKey}"][data-asset-id="${domKey}"]`;
        const elements = document.querySelectorAll(selector);
        if (!elements || elements.length === 0) {
            return;
        }
        elements.forEach(el => {
            if (isLoading) {
                el.classList.add('loading');
            } else {
                el.classList.remove('loading');
            }
        });
    };
