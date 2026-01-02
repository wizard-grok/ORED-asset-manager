if (typeof DeroNFTApp !== 'undefined') {

    // Helper: Extract SCIDs from asset string (used by collection scanning)
    DeroNFTApp.prototype.extractScidsFromAssetString = function(rawValue) {
        if (!rawValue) return [];
        let decoded = rawValue;
        if (/^[0-9a-fA-F]+$/.test(rawValue) && rawValue.length % 2 === 0) {
            decoded = this.decodeHexString ? this.decodeHexString(rawValue) : rawValue;
        }
        if (!decoded) return [];
        try {
            const parsed = JSON.parse(decoded);
            if (Array.isArray(parsed)) {
                return parsed.filter(item => typeof item === 'string' && /^[0-9a-fA-F]{64}$/.test(item));
            }
        } catch (error) {
            // Not JSON; fall back to regex extraction
        }
        const matches = decoded.match(/[0-9a-fA-F]{64}/g);
        return matches ? matches : [];
    }

    // Fetch child NFT SCIDs from a collection contract
    DeroNFTApp.prototype.fetchCollectionAssetScidsFromContract = async function(collectionScid) {
        if (!collectionScid || !this.deroWallet?.ws?.getSC) {
            return [];
        }
        try {
            const scState = await this.deroWallet.ws.getSC(collectionScid, false, true);
            if (!scState) {
                console.warn('⚠️ [fetchCollectionAssetScidsFromContract] getSC returned null/undefined');
                return [];
            }
            const scData = scState?.result || scState;
            if (!scData || (typeof scData !== 'object')) {
                console.warn('⚠️ [fetchCollectionAssetScidsFromContract] Invalid scData structure:', scData);
                return [];
            }
            const stringKeys = (scData && scData.stringkeys) ? scData.stringkeys : {};
            const uint64Keys = (scData && scData.uint64keys) ? scData.uint64keys : {};
            const scids = new Set();
            
            // Method 1: Check for assets_* keys (some collections store asset SCIDs this way)
            for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                if (!decodedKey) continue;
                const normalizedKey = decodedKey.toLowerCase();
                
                if (normalizedKey.startsWith('assets_')) {
                    const entries = this.extractScidsFromAssetString(rawValue);
                    entries.forEach(entry => {
                        if (entry && /^[0-9a-fA-F]{64}$/.test(entry)) {
                            scids.add(entry.toLowerCase());
                        }
                    });
                }
            }
            
            // Method 2: Check for keys that store NFT SCIDs when NFTs are added via SetCollection
            // Collections might store NFT SCIDs in keys like: nft_<scid>, asset_<scid>, registered_<scid>, etc.
            // When an NFT calls SetCollection, the collection might store the NFT SCID
            const nftScidPatterns = ['nft_', 'asset_', 'registered_', 'member_', 'item_'];
            for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                if (!decodedKey) continue;
                const normalizedKey = decodedKey.toLowerCase();
                
                // Check if key matches pattern like "nft_<scid>" where <scid> is the NFT SCID
                for (const pattern of nftScidPatterns) {
                    if (normalizedKey.startsWith(pattern)) {
                        const afterPrefix = decodedKey.substring(pattern.length);
                        if (afterPrefix && /^[0-9a-fA-F]{64}$/i.test(afterPrefix)) {
                            scids.add(afterPrefix.toLowerCase());
                        }
                    }
                }
            }
            
            // Method 3: Check for token_* or nft_* keys (some collections use this pattern)
            for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                if (!decodedKey) continue;
                const normalizedKey = decodedKey.toLowerCase();
                
                // Some collections store SCIDs in token_* or nft_* keys
                if (normalizedKey.startsWith('token_') || normalizedKey.startsWith('nft_')) {
                    const potentialScid = decodedKey.substring(6); // Remove "token_" or "nft_" prefix
                    if (potentialScid && /^[0-9a-fA-F]{64}$/i.test(potentialScid)) {
                        scids.add(potentialScid.toLowerCase());
                    }
                }
            }
            
            // Method 4: Try calling collection functions that might return NFT SCIDs
            // Common function names: GetAssets, GetAllAssets, ListAssets, GetNFTs
            const collectionFunctions = ['GetAssets', 'GetAllAssets', 'ListAssets', 'GetNFTs', 'GetCollectionAssets'];
            for (const funcName of collectionFunctions) {
                try {
                    const funcResult = await this.deroWallet.ws.getSC(collectionScid, funcName, []);
                    if (funcResult && !funcResult.error && funcResult.result) {
                        const assetsValue = this.deroWallet.ws.extractValue ? this.deroWallet.ws.extractValue(funcResult) : null;
                        if (assetsValue) {
                            // Try to parse as JSON array or extract SCIDs
                            try {
                                const parsed = typeof assetsValue === 'string' ? JSON.parse(assetsValue) : assetsValue;
                                if (Array.isArray(parsed)) {
                                    parsed.forEach(item => {
                                        const scid = typeof item === 'string' ? item : item.scid || item.id;
                                        if (scid && /^[0-9a-fA-F]{64}$/i.test(scid)) {
                                            scids.add(scid.toLowerCase());
                                        }
                                    });
                                }
                            } catch (e) {
                                // Not JSON, try extracting SCIDs from string
                                const scidMatches = String(assetsValue).match(/[0-9a-fA-F]{64}/gi);
                                if (scidMatches) {
                                    scidMatches.forEach(match => {
                                        if (/^[0-9a-fA-F]{64}$/i.test(match)) {
                                            scids.add(match.toLowerCase());
                                        }
                                    });
                                }
                            }
                            // If we found assets from a function, that's likely the authoritative source
                            if (scids.size > 0) {
                                break;
                            }
                        }
                    }
                } catch (e) {
                    // Function not available, try next one
                    continue;
                }
            }
            
            // Method 5: Check for specific collection-related keys that might contain SCIDs
            // Only check keys that are likely to contain NFT SCIDs, not all keys
            const collectionKeyPatterns = ['asset_', 'nft_', 'token_', 'item_', 'child_', 'member_'];
            for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                if (!decodedKey) continue;
                const normalizedKey = decodedKey.toLowerCase();
                
                // Only check keys that match collection patterns
                const matchesPattern = collectionKeyPatterns.some(pattern => normalizedKey.startsWith(pattern));
                if (!matchesPattern && !normalizedKey.startsWith('assets_')) {
                    continue; // Skip keys that don't match collection patterns
                }
                
                // Check if the value contains SCIDs (only in collection-related keys)
                if (rawValue && typeof rawValue === 'string') {
                    const scidMatches = rawValue.match(/[0-9a-fA-F]{64}/gi);
                    if (scidMatches) {
                        scidMatches.forEach(match => {
                            if (/^[0-9a-fA-F]{64}$/i.test(match)) {
                                scids.add(match.toLowerCase());
                            }
                        });
                    }
                }
            }
            
            // Method 6: Check for 'assets' or 'assetList' key that might contain array of SCIDs
            const assetListKeys = ['assets', 'assetlist', 'nftlist', 'tokenlist', 'items'];
            for (const listKey of assetListKeys) {
                if (stringKeys[listKey]) {
                    const listValue = stringKeys[listKey];
                    const decoded = this.decodeHexString ? this.decodeHexString(listValue) : listValue;
                    if (decoded) {
                        try {
                            const parsed = JSON.parse(decoded);
                            if (Array.isArray(parsed)) {
                                parsed.forEach(item => {
                                    const scid = typeof item === 'string' ? item : item.scid || item.id;
                                    if (scid && /^[0-9a-fA-F]{64}$/i.test(scid)) {
                                        scids.add(scid.toLowerCase());
                                    }
                                });
                            }
                        } catch (e) {
                            // Not JSON, try extracting SCIDs
                            const scidMatches = String(decoded).match(/[0-9a-fA-F]{64}/gi);
                            if (scidMatches) {
                                scidMatches.forEach(match => {
                                    if (/^[0-9a-fA-F]{64}$/i.test(match)) {
                                        scids.add(match.toLowerCase());
                                    }
                                });
                            }
                        }
                    }
                }
            }
            
            // Method 7: If this is a token-based collection (has TotalSupply), we can't get SCIDs this way
            // For token-based collections, each tokenId maps to a SCID that needs to be queried separately
            // This function is for single-SCID collections where each NFT has its own SCID
            
            const scidsArray = Array.from(scids);
            return scidsArray;
        } catch (error) {
            return [];
        }
    }

    // Prepare asset for scanning (enrich with metadata if needed)
    DeroNFTApp.prototype.prepareAssetForScan = async function(asset, collectionScid) {
        if (!asset) return null;
        let prepared = { ...asset };
        if (!prepared.scid && prepared.id && /^[0-9a-fA-F]{64}$/.test(prepared.id)) {
            prepared.scid = prepared.id;
        }
        if (collectionScid && !prepared.collection_scid) {
            prepared.collection_scid = collectionScid;
        }
        if (this.enrichAssetWithG45 && prepared.scid) {
            const enriched = await this.enrichAssetWithG45(prepared);
            prepared = enriched || prepared;
        }
        return prepared;
    }

    // Scan progress UI helpers
    DeroNFTApp.prototype.startScanProgress = function(total = 0, label = 'Scanning collection...') {
        const loadingEl = document.getElementById('loadingSearch');
        if (!loadingEl) return;
        if (!this.loadingTemplates) {
            this.loadingTemplates = {};
        }
        if (!this.loadingTemplates.loadingSearch) {
            this.loadingTemplates.loadingSearch = loadingEl.innerHTML;
        }
        loadingEl.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span class="scan-progress-label">${label}</span>
            <span class="scan-progress-count">${total > 0 ? `0/${total}` : ''}</span>
        `;
        loadingEl.classList.remove('hidden');
        this.collectionScanState = { total, processed: 0 };
    }

    DeroNFTApp.prototype.updateScanProgress = function(processed, total = 0, label) {
        const loadingEl = document.getElementById('loadingSearch');
        if (!loadingEl) return;
        const labelEl = loadingEl.querySelector('.scan-progress-label');
        const countEl = loadingEl.querySelector('.scan-progress-count');
        if (labelEl && label) {
            labelEl.textContent = label;
        }
        if (countEl) {
            if (total > 0) {
                countEl.textContent = `${processed}/${total}`;
            } else {
                countEl.textContent = `${processed}`;
            }
        }
        if (this.collectionScanState) {
            this.collectionScanState.processed = processed;
            this.collectionScanState.total = total;
        }
    }

    DeroNFTApp.prototype.finishScanProgress = function() {
        const loadingEl = document.getElementById('loadingSearch');
        if (!loadingEl) return;
        const template = this.loadingTemplates?.loadingSearch;
        if (template) {
            loadingEl.innerHTML = template;
        }
        loadingEl.classList.add('hidden');
        this.collectionScanState = null;
    }

    // Legacy ownership check (uses cache/saved assets)
    DeroNFTApp.prototype.determineOwnershipStatusForAsset = async function(asset, collectionScid) {
        if (!asset || !this.currentAddress) {
            return 'unknown';
        }
        const currentAddr = this.currentAddress.toLowerCase();
        const matchKeys = this.normalizeAssetMatchKeys(asset);
        const overrideStatus = this.getOwnershipOverride ? this.getOwnershipOverride(asset.scid, asset.tokenId) : null;
        if (overrideStatus) {
            return overrideStatus;
        }

        if (asset.owner && asset.owner.toLowerCase() === currentAddr) {
            return asset.displayed ? 'displayed' : 'owned';
        }
        if (asset.owned) {
            return asset.displayed ? 'displayed' : 'owned';
        }

        const savedMatch = (this.savedAssets || []).find(saved => this.matchesAssetKeys(saved, matchKeys));
        if (savedMatch) {
            if (savedMatch.displayed || savedMatch.displayStatus === 'displayed') {
                asset.displayed = true;
                return 'displayed';
            }
            if (savedMatch.owned) {
                return 'owned';
            }
        }

        const transferAssets = await this.ensureTransferAssetCache();
        const transferMatch = transferAssets.find(item => this.matchesAssetKeys(item, matchKeys));
        if (transferMatch) {
            if (transferMatch.displayed) {
                asset.displayed = true;
                return 'displayed';
            }
            if (transferMatch.owned) {
                return 'owned';
            }
        }

        const inSellOrder = this.checkAssetInOrders ? this.checkAssetInOrders(asset, 'sell') : false;
        const inBuyOrder = this.checkAssetInOrders ? this.checkAssetInOrders(asset, 'buy') : false;
        if (inSellOrder || inBuyOrder) {
            return 'in-contract';
        }

        return 'not-owned';
    }

    // Force a fresh on-chain-only ownership inference (no saved/override influence)
    // Uses GetBalance(scid) for private ownership detection + DERO.GetSC for public state
    // Simplified and cleaned up to prevent race conditions and crashes
    DeroNFTApp.prototype.determineOwnershipStatusForAssetFresh = async function(asset) {
        try {
            if (!asset || !this.currentAddress) {
                return 'unknown';
            }
            
            if (!asset.scid) {
                return 'unknown';
            }

            // Normalize SCID to lowercase and validate format
            let scid = asset.scid;
            if (scid) {
                scid = scid.toLowerCase().trim();
                // Validate SCID is 64 hex characters
                if (!/^[0-9a-f]{64}$/.test(scid)) {
                    return 'unknown';
                }
            }
        

            // Build address matching function
            const buildAddressVariants = (address) => {
                if (!address) return [];
                const lower = address.toLowerCase();
                const variants = [lower];
                if (lower.startsWith('deto')) {
                    variants.push('dero' + lower.slice(4));
                } else if (lower.startsWith('dero')) {
                    variants.push('deto' + lower.slice(4));
                }
                return variants;
            };

            const addressVariants = buildAddressVariants(this.currentAddress);
            const addressMatches = (candidate) => {
                if (!candidate) return false;
                const normalized = candidate.toLowerCase();
                return addressVariants.some(variant => {
                    if (!variant) return false;
                    if (normalized === variant) return true;
                    const minLen = Math.min(normalized.length, variant.length);
                    if (minLen >= 50) {
                        return normalized.substring(0, minLen - 6) === variant.substring(0, minLen - 6);
                    }
                    return false;
                });
            };

            // STEP 1: Check private balance first - this is the definitive ownership check
            // For NFT/NFA, the owner is whoever has the balance, not the contract creator
            // Gnomon.GetOwner might return the contract creator/minter, which doesn't change when you transfer
            let privateBalance = 0;
            try {
                if (this.deroWallet && this.deroWallet.getBalance) {
                    privateBalance = await this.deroWallet.getBalance(null, scid);
                    if (privateBalance > 0) {
                        return 'owned';
                    }
                }
            } catch (error) {
                // Continue to other checks - don't crash
            }
            
            // STEP 2: If wallet is not owner, check displayed/in-contract via DERO.GetSC
            let inContract = false;
            let displayedFromContract = false;
            let ownerFromContract = null;
        
        try {
            const sc = await this.getSCWithCache(scid);
                
                if (sc) {
                    // Handle both response formats: sc.result or sc directly
                    const data = sc.result || sc;
                    if (!data) {
                        throw new Error('DERO.GetSC returned empty data');
                    }
                    const stringKeys = data.stringkeys || {};
                    const uint64Keys = data.uint64keys || {};
                    
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
                    const decS = (k) => {
                        const raw = stringKeys[k];
                        if (!raw) return '';
                        return this.decodeHexString ? this.decodeHexString(raw) : raw;
                    };

                    // Extract owner from contract fields - check all owner fields
                    const decodeKey = (key) => {
                        if (!key) return '';
                        try {
                            return this.decodeHexString ? this.decodeHexString(key) : key;
                        } catch (e) {
                            return key;
                        }
                    };

                    // Helper to extract address from various formats (hex, raw, etc.)
                    const extractAddress = (value) => {
                        if (!value) return null;
                        let decoded = value;
                        
                        // Try decoding if it looks like hex
                        if (typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length > 40) {
                            try {
                                decoded = decodeKey(value);
                                // If decoded is still hex-looking, try converting bytes to string
                                if (/^[0-9a-fA-F]+$/.test(decoded)) {
                                    const bytes = [];
                                    for (let i = 0; i < decoded.length; i += 2) {
                                        const byte = parseInt(decoded.substr(i, 2), 16);
                                        if (byte >= 32 && byte < 127) bytes.push(byte);
                                    }
                                    if (bytes.length > 50) {
                                        decoded = String.fromCharCode(...bytes);
                                    }
                                }
                            } catch (e) {
                                // Keep original
                            }
                        }
                        
                        // Check if it looks like a DERO address
                        if (typeof decoded === 'string') {
                            const normalized = decoded.trim();
                            if ((normalized.startsWith('dero') || normalized.startsWith('deto')) && normalized.length > 50) {
                                return normalized;
                            }
                        }
                        return null;
                    };

                    // Extract all display addresses (from owner_* fields with amounts > 0)
                    // Also check owner_* fields for primary owner
                    let displayedAddresses = [];
                    for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                        if (!rawKey || !rawValue) continue;
                        const decodedKey = decodeKey(rawKey);
                        const keyToCheck = (decodedKey || rawKey || '').toLowerCase().trim();
                        
                        // Check owner_* pattern (e.g., owner_dero1qyre...)
                        // G45 DisplayToken stores: STORE("owner_" + signerString, amount)
                        // The key is "owner_<address>" where address comes from ADDRESS_STRING(SIGNER())
                        // ADDRESS_STRING returns the address in hex format (64 chars) or integrated format
                        if (keyToCheck.startsWith('owner_')) {
                            const ownerAddrRaw = (decodedKey || rawKey || '').substring(6).trim();
                            
                            // Try multiple extraction methods
                            let extracted = extractAddress(ownerAddrRaw);
                            
                            // If extraction failed, try direct hex decode
                            if (!extracted && ownerAddrRaw.length === 64 && /^[0-9a-f]+$/i.test(ownerAddrRaw)) {
                                // Might be a raw hex address - try to use it directly
                                extracted = ownerAddrRaw.toLowerCase();
                            }
                            
                            // Also try decoding the key itself if it's hex
                            if (!extracted) {
                                try {
                                    const hexDecoded = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                                    if (hexDecoded && hexDecoded.toLowerCase().startsWith('owner_')) {
                                        const addrPart = hexDecoded.substring(6);
                                        extracted = extractAddress(addrPart) || addrPart;
                                    }
                                } catch (e) {
                                    // Ignore decode errors
                                }
                            }
                            
                            if (extracted) {
                                // Get amount from string value or check uint64Keys
                                let amount = 0;
                                
                                // Check uint64Keys first (more reliable for numeric values)
                                if (uint64Keys[rawKey] !== undefined) {
                                    amount = parseInt(uint64Keys[rawKey], 10) || 0;
                                }
                                
                                // If not found in uint64Keys, try parsing string value
                                if (amount === 0 && rawValue) {
                                    // Try parsing as decimal number
                                    amount = parseInt(rawValue, 10) || 0;
                                    // If that fails, try hex
                                    if (amount === 0) {
                                        amount = parseInt(rawValue, 16) || 0;
                                    }
                                }
                                
                                // For G45 NFTs, displayed means amount >= 100000
                                if (amount >= 100000) {
                                    displayedAddresses.push({ address: extracted, amount });
                                    // Check if wallet matches displayed address
                                    if (addressMatches(extracted)) {
                                        displayedFromContract = true;
                                        inContract = true; // Displayed = in contract escrow
                                    }
                                }
                                
                                // Also store as primary owner if no owner found yet
                                if (!ownerFromContract) {
                                    ownerFromContract = extracted;
                                }
                            }
                        }
                        
                        // Check if key itself is an address (some contracts store owner as key)
                        if (keyToCheck.length > 50 && (keyToCheck.startsWith('dero') || keyToCheck.startsWith('deto'))) {
                            const extracted = extractAddress(decodedKey || rawKey);
                            if (extracted && !ownerFromContract) {
                                ownerFromContract = extracted;
                            }
                        }
                    }

                    // Check direct owner fields (priority: owner > currentOwner > minter/originalOwner)
                    const ownerFields = ['owner', 'currentOwner', 'current_owner'];
                    const authorFields = ['minter', 'originalOwner', 'original_owner', 'creator', 'author'];
                    const allOwnerFields = [...ownerFields, ...authorFields];
                    
                    let authorFromContract = null;
                    
                    for (const field of allOwnerFields) {
                        const rawOwner = stringKeys[field];
                        if (!rawOwner) continue;
                        const extracted = extractAddress(rawOwner);
                        if (extracted) {
                            // Primary owner fields (owner, currentOwner)
                            if (ownerFields.includes(field)) {
                                if (!ownerFromContract) {
                                    ownerFromContract = extracted;
                                }
                                if (addressMatches(extracted)) {
                                    displayedFromContract = true;
                                }
                            }
                            // Author/creator fields (minter, originalOwner)
                            if (authorFields.includes(field) && !authorFromContract) {
                                authorFromContract = extracted;
                            }
                        }
                    }

                    // Extract buy/sell order information from contract state
                    // For ART-NFA-MS1 and marketplace contracts
                    let orderCreator = null;
                    let orderBuyer = null;
                    
                    // Check for sell order fields (ART-NFA-MS1)
                    const sellOrderFields = ['seller', 'listCreator', 'list_creator', 'orderCreator'];
                    for (const field of sellOrderFields) {
                        const rawOrderCreator = stringKeys[field];
                        if (rawOrderCreator && !orderCreator) {
                            const extracted = extractAddress(rawOrderCreator);
                            if (extracted) {
                                orderCreator = extracted;
                            }
                        }
                    }
                    
                    // Check for buy order fields
                    const buyOrderFields = ['buyer', 'orderBuyer', 'order_buyer', 'fulfilledBy'];
                    for (const field of buyOrderFields) {
                        const rawOrderBuyer = stringKeys[field];
                        if (rawOrderBuyer && !orderBuyer) {
                            const extracted = extractAddress(rawOrderBuyer);
                            if (extracted) {
                                orderBuyer = extracted;
                            }
                        }
                    }
                    

                    // Also check data.owner, data.minter, data.originalOwner if available (top-level fields)
                    const dataOwnerFields = ['owner', 'minter', 'originalOwner', 'currentOwner'];
                    for (const field of dataOwnerFields) {
                        if (data[field] && !ownerFromContract && ownerFields.includes(field)) {
                            const extracted = extractAddress(data[field]);
                            if (extracted) {
                                ownerFromContract = extracted;
                            }
                        }
                        if (data[field] && !authorFromContract && authorFields.includes(field)) {
                            const extracted = extractAddress(data[field]);
                            if (extracted) {
                                authorFromContract = extracted;
                            }
                        }
                    }
                    
                    // Store extracted information in asset object for later use
                    if (authorFromContract) {
                        asset.author = authorFromContract;
                        asset.creator = authorFromContract;
                    }
                    if (orderCreator) {
                        asset.orderCreator = orderCreator;
                    }
                    if (orderBuyer) {
                        asset.orderBuyer = orderBuyer;
                    }
                    if (displayedAddresses.length > 0) {
                        asset.displayedAddresses = displayedAddresses;
                    }

                    // Check for ART-NFA-MS1 in-contract status
                    if (this.isArtificerAsset && this.isArtificerAsset(asset)) {
                        const active = decU('active');
                        const scBalance = decU('scBalance');
                        const listType = decS('listType');
                        const owner = decS('owner');
                        const startPrice = decU('startPrice');
                        const startBlockTime = decU('startBlockTime');
                        const endBlockTime = decU('endBlockTime');
                        
                        
                        // Check if wallet is the owner (more lenient matching)
                        const isOwner = owner && addressMatches(owner);
                        
                        // NFA is in-contract if ANY of these conditions:
                        // 1. Active listing (active === 1, scBalance === 1, listType is sale/auction)
                        // 2. OR owner matches and there's listing data (even if active is 0, might be pending confirmation)
                        // 3. OR scBalance > 0 (asset is escrowed in contract - most reliable indicator)
                        // 4. OR owner matches and scBalance === 1 (owner has escrowed the asset)
                        // 5. OR owner matches and listType exists (listing was created, even if not yet active)
                        if (active === 1 && scBalance === 1 && (listType === 'sale' || listType === 'auction')) {
                            inContract = true;
                        } else if (scBalance > 0) {
                            // Asset is escrowed in contract - most reliable indicator
                            inContract = true;
                        } else if (isOwner && (startPrice > 0 || listType === 'sale' || listType === 'auction')) {
                            // Owner has listing data - might be pending confirmation or recently listed
                            inContract = true;
                        } else if (isOwner && scBalance === 1) {
                            // Owner matches and balance is escrowed
                            inContract = true;
                        } else if (listType === 'sale' || listType === 'auction') {
                            // Listing exists (might be pending or expired, but was listed)
                            inContract = true;
                        }
                    }
                }
            } catch (error) {
                // Don't crash - continue with empty data
            }

            // STEP 3: Determine final status based on completed queries
            // Priority: in-contract > displayed > not-owned (if owner found but doesn't match) > unknown

            // Public on-chain status (from DERO.GetSC)
            if (inContract) {
                return 'in-contract';
            }

            if (displayedFromContract) {
                return 'displayed';
            }

            // Check if contract owner found but doesn't match wallet
            if (ownerFromContract) {
                if (addressMatches(ownerFromContract)) {
                    return 'owned';
                } else {
                    return 'not-owned';
                }
            }

            // No owner found in contract state - mark as not-owned
            return 'not-owned';
        } catch (error) {
            return 'not-owned';
        }
    }

    // XSWD Improvement: Batch ownership check for collections
    // Based on: https://tela.derod.org/xswd
    // This is used for collection scans, not individual asset checks
    DeroNFTApp.prototype.batchCheckOwnership = async function(scids) {
        if (!scids || !Array.isArray(scids) || scids.length === 0) {
            return {};
        }

        if (!this.currentAddress || !this.deroWallet) {
            return {};
        }


        // Group into batches (processed sequentially to keep Engram prompts one-at-a-time)
        const batchSize = 3;
        const results = {};
        
        for (let i = 0; i < scids.length; i += batchSize) {
            const batch = scids.slice(i, i + batchSize);
            
            // Check cache first
            const cached = batch.map(scid => ({
                scid,
                cached: this.cacheManager ? this.cacheManager.get(`ownership:${scid}`, 'ownership') : null
            }));
            
            // Only query uncached
            const toQuery = cached.filter(item => !item.cached).map(item => item.scid);
            
            if (toQuery.length > 0) {
                
                for (const scid of toQuery) {
                    try {
                        const balance = await this.deroWallet.getBalance(this.currentAddress, scid);
                        const status = balance > 0 ? 'owned' : 'not-owned';
                        results[scid] = status;
                        if (this.cacheManager) {
                            this.cacheManager.set(`ownership:${scid}`, status, 'ownership');
                        }
                    } catch (error) {
                        results[scid] = 'unknown';
                    }
                }
            }
            
            // Add cached results
            cached.forEach(({ scid, cached }) => {
                if (cached) {
                    results[scid] = cached;
                }
            });
            
            // Rate limit: wait between batches (queue handles this, but extra safety)
            if (i + batchSize < scids.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return results;
    }

    // XSWD Improvement: Get SC with caching
    DeroNFTApp.prototype.getSCWithCache = async function(scid, forceRefresh = false) {
        if (!scid) return null;
        
        const cacheKey = `sc:${scid}`;
        
        // Check cache first
        if (!forceRefresh && this.cacheManager) {
            const cached = this.cacheManager.get(cacheKey, 'contractState');
            if (cached) {
                return cached;
            }
        }
        
        // Fetch fresh data
        if (!this.deroWallet?.ws?.getSC) {
            return null;
        }
        
        try {
            const sc = await this.deroWallet.ws.getSC(scid);
            
            // Cache it
            if (this.cacheManager) {
                this.cacheManager.set(cacheKey, sc, 'contractState');
            }
            
            return sc;
        } catch (error) {
            return null;
        }
    }

    // Scan collection for wallet assets
    DeroNFTApp.prototype.scanCollectionForWallet = async function(scid) {
        if (!this.currentAddress) {
            this.showError('Please connect your wallet first');
            return;
        }
        if (!scid) {
            this.showError('Collection SCID is required for scanning');
            return;
        }

        this.startScanProgress(0, 'Preparing collection scan...');
        
        try {
            const summary = await this.scanCollectionForWalletAssets(scid);
            this.finishScanProgress();
            if (!summary || !summary.assets || summary.assets.length === 0) {
                this.showNotification('No assets from this collection were found in your wallet history.', 'info');
                return;
            }
            this.showCollectionScanResults(scid, summary);
        } catch (error) {
            this.finishScanProgress();
            this.showError(`Failed to scan collection: ${error.message}`);
        }
    }

    // Asset type classification functions (moved from appcore.js)
    DeroNFTApp.prototype.classifyAssetType = function(contractType, fallbackType, isCollectionFlag = false) {
        const normalized = (contractType || '').toUpperCase();
        if (isCollectionFlag || normalized === 'G45-C') {
            return 'Collection';
        }
        if (normalized === 'G45-AT' || normalized.startsWith('G45-')) {
            return 'NFT';
        }
        if (
            normalized === 'NFA-MS1' ||
            normalized === 'ART-NFA-MS1' ||
            normalized === 'T345' ||
            normalized.startsWith('NFA') ||
            normalized.includes('MS1')
        ) {
            return 'NFA';
        }
        return fallbackType || (isCollectionFlag ? 'Collection' : 'NFT');
    }

    DeroNFTApp.prototype.isG45Asset = function(asset) {
        if (!asset) return false;
        const type = (asset.contractType || asset.type || '').toUpperCase();
        return type.includes('G45-AT') || type.includes('G45-C') || type.includes('G45');
    }

    DeroNFTApp.prototype.isArtificerAsset = function(asset) {
        if (!asset) return false;
        const type = (asset.contractType || asset.type || '').toUpperCase();
        const format = (asset.metadataFormat || '').toUpperCase();
        return type.includes('T345') || type.includes('NFA') || format.includes('ART-NFA-MS1');
    }

    DeroNFTApp.prototype.isCollectionAsset = function(asset) {
        if (!asset) return false;
        if (asset.isCollection) return true;
        const classification = this.classifyAssetType
            ? this.classifyAssetType(asset.contractType, asset.type, asset.isCollection)
            : (asset.type || '');
        return String(classification || '').toLowerCase() === 'collection';
    }

    // Asset matching functions (moved from appcore.js)
    DeroNFTApp.prototype.normalizeAssetMatchKeys = function(asset) {
        const keys = new Set();
        if (!asset) return keys;
        const add = (value) => {
            if (value !== undefined && value !== null && String(value).length > 0) {
                keys.add(String(value).toLowerCase());
            }
        };
        add(asset.id);
        add(asset.scid);
        if (asset.scid && asset.tokenId !== undefined && asset.tokenId !== null && asset.tokenId !== '') {
            add(`${asset.scid}_${asset.tokenId}`);
        }
        return keys;
    }

    DeroNFTApp.prototype.matchesAssetKeys = function(asset, referenceKeys) {
        if (!asset || !referenceKeys || referenceKeys.size === 0) {
            return false;
        }
        const assetKeys = this.normalizeAssetMatchKeys(asset);
        for (const key of assetKeys) {
            if (referenceKeys.has(key)) {
                return true;
            }
        }
        return false;
    }

    // Ownership override functions (moved from appcore.js)
    DeroNFTApp.prototype.buildOwnershipKey = function(scid, tokenId) {
        const normalizedScid = (scid || '').toLowerCase();
        const tokenPart = (tokenId !== undefined && tokenId !== null && tokenId !== '') ? String(tokenId) : '';
        return `${normalizedScid}_${tokenPart}`;
    }

    DeroNFTApp.prototype.setOwnershipOverride = function(scid, tokenId, status) {
        if (!this.ownershipOverrides) {
            this.ownershipOverrides = new Map();
        }
        const key = this.buildOwnershipKey(scid, tokenId);
        if (!key.trim()) return;
        if (!status) {
            this.ownershipOverrides.delete(key);
        } else {
            this.ownershipOverrides.set(key, status);
        }
    }

    DeroNFTApp.prototype.getOwnershipOverride = function(scid, tokenId) {
        if (!this.ownershipOverrides) return null;
        const key = this.buildOwnershipKey(scid, tokenId);
        return this.ownershipOverrides.get(key) || null;
    }

    // Asset query functions moved to appfeat6.js

    // Collection scanning functions (moved from appfeat2.js)
    DeroNFTApp.prototype.scanCollectionForWalletAssets = async function(scid) {
        const summary = {
            assets: [],
            totalCandidates: 0
        };
        
        try {
            if (!this.deroWallet || !this.deroWallet.ws || !this.currentAddress) {
                return summary;
            }

            const candidateMap = new Map();

            const cachedAssets = this.getCollectionAssets ? this.getCollectionAssets(scid) : [];
            cachedAssets.forEach(asset => {
                if (!asset) return;
                const key = (asset.id || asset.scid || '').toLowerCase();
                if (!key) return;
                candidateMap.set(key, asset);
            });

            const contractScids = await this.fetchCollectionAssetScidsFromContract(scid);
            contractScids.forEach(childScid => {
                if (!childScid) return;
                const key = childScid.toLowerCase();
                if (!candidateMap.has(key)) {
                    candidateMap.set(key, { scid: childScid, id: childScid });
                }
            });

            // Query all tokens from collection (using DERO.GetSC, not GetTransfers)
            // This gets all tokens regardless of ownership
            try {
                if (this.queryAllCollectionNFTs) {
                    const allTokens = await this.queryAllCollectionNFTs(scid);
                    allTokens.forEach(token => {
                        if (!token) return;
                        const key = token.tokenId ? `${token.scid}_${token.tokenId}`.toLowerCase() : token.scid.toLowerCase();
                        if (!candidateMap.has(key)) {
                            candidateMap.set(key, token);
                        }
                    });
                }
            } catch (queryError) {
            }

            const candidates = Array.from(candidateMap.values());
            summary.totalCandidates = candidates.length;

            if (candidates.length === 0) {
                return summary;
            }

            // Use the new ownership check method (Gnomon.GetOwner + DERO.GetSC) for each asset
            
            let processed = 0;
            for (const candidate of candidates) {
                processed += 1;
                const scidPreview = candidate.scid ? candidate.scid.substring(0, 8) : 'token';
                this.updateScanProgress(processed, candidates.length, `Checking ownership: ${scidPreview}...`);

                const prepared = await this.prepareAssetForScan(candidate, scid);
                if (!prepared || !prepared.scid) continue;

                // Use GetBalance + DERO.GetSC to check ownership (no GetTransfers permission needed)
                // This checks: 1) wallet balance, 2) displayed status (owner_ keys), 3) in-contract status
                let ownershipStatus = 'not-owned'; // Default to not-owned
                try {
                    // First check wallet balance
                    let walletBalance = 0;
                    try {
                        walletBalance = await this.deroWallet.getBalance(null, prepared.scid);
                    } catch (balanceError) {
                    }
                    
                    if (walletBalance > 0) {
                        ownershipStatus = 'owned';
                    } else {
                        // Check contract state for displayed/in-contract status
                        if (this.determineOwnershipStatusForAssetFresh) {
                            ownershipStatus = await this.determineOwnershipStatusForAssetFresh(prepared);
                        } else {
                            // Fallback: just check contract state directly
                            try {
                                const scResult = await this.deroWallet.ws.getSC(prepared.scid);
                                const scData = scResult?.result || scResult;
                                if (scData) {
                                    // Check for displayed status (owner_ keys for G45 NFTs)
                                    const stringKeys = scData.stringkeys || {};
                                    const uint64Keys = scData.uint64keys || {};
                                    const currentAddress = this.currentAddress || '';
                                    
                                    if (currentAddress) {
                                        // Check owner_ keys for displayed NFTs
                                        for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                                            const keyLower = rawKey.toLowerCase();
                                            if (keyLower.startsWith('owner_')) {
                                                const ownerAddr = rawKey.substring(6);
                                                if (ownerAddr.toLowerCase().includes(currentAddress.toLowerCase().substring(0, 50))) {
                                                    let amount = 0;
                                                    if (uint64Keys[rawKey] !== undefined) {
                                                        amount = parseInt(uint64Keys[rawKey], 10) || 0;
                                                    } else if (rawValue) {
                                                        amount = parseInt(rawValue, 10) || parseInt(rawValue, 16) || 0;
                                                    }
                                                    if (amount >= 100000) {
                                                        ownershipStatus = 'displayed';
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        
                                        // Check for NFA in-contract status
                                        const active = uint64Keys['active'] !== undefined ? parseInt(uint64Keys['active'], 10) : 0;
                                        const scBalance = uint64Keys['scBalance'] !== undefined ? parseInt(uint64Keys['scBalance'], 10) : 0;
                                        const listType = stringKeys['listType'] ? (this.decodeHexString ? this.decodeHexString(stringKeys['listType']) : stringKeys['listType']) : '';
                                        const owner = stringKeys['owner'] ? (this.decodeHexString ? this.decodeHexString(stringKeys['owner']) : stringKeys['owner']) : '';
                                        
                                        if (scBalance > 0 || (active === 1 && (listType === 'sale' || listType === 'auction'))) {
                                            ownershipStatus = 'in-contract';
                                        }
                                    }
                                }
                            } catch (scError) {
                            }
                        }
                    }
                } catch (error) {
                    ownershipStatus = 'not-owned'; // On error, mark as not-owned
                }

                // Update asset with ownership status
                prepared.ownershipStatus = ownershipStatus;
                prepared.owned = ownershipStatus === 'owned' || ownershipStatus === 'displayed';
                if (ownershipStatus === 'displayed') {
                    prepared.displayed = true;
                }
                if (ownershipStatus === 'in-contract') {
                    prepared.inContract = true;
                }

                summary.assets.push(prepared);
                
                // Small delay between checks to avoid overwhelming Engram (Gnomon.GetOwner is fast, but still rate limit)
                if (processed < candidates.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        } catch (error) {
        }
        
        return summary;
    };

    DeroNFTApp.prototype.showCollectionScanResults = function(scid, summary) {
        const assets = summary?.assets || [];
        const total = summary?.totalCandidates || assets.length;
        const ownedCount = assets.filter(asset => asset.owned).length;
        const inContract = assets.filter(asset => asset.ownershipStatus === 'in-contract').length;
        const displayedCount = assets.filter(asset => asset.displayed).length;

        const cardsHtml = assets.length > 0
            ? assets.map((asset, index) => this.renderAssetCard(asset, index, 'scan')).join('')
            : '<div class="text-center mt-20">No assets found for this collection.</div>';

        const modalHtml = `
            <div class="modal active" id="collectionScanModal" onclick="if(event.target.id === 'collectionScanModal') app.hideCollectionScanResults()">
                <div class="modal-content" style="max-width: 95vw; max-height: 90vh; overflow-y: auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <div>
                            <h2 style="margin:0;">Collection Scan Results</h2>
                            <p style="margin:4px 0 0 0;font-size:0.9rem;color:#aaa;">SCID: ${scid}</p>
                        </div>
                        <button class="btn btn-secondary" onclick="app.hideCollectionScanResults()">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                    <div class="scan-summary" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
                        <span class="badge badge-info">Candidates: ${total}</span>
                        <span class="badge badge-success">Owned: ${ownedCount}</span>
                        <span class="badge badge-warning">Displayed: ${displayedCount}</span>
                        <span class="badge badge-primary">In Contract: ${inContract}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;">
                        ${cardsHtml}
                    </div>
                </div>
            </div>
        `;

        const existing = document.getElementById('collectionScanModal');
        if (existing) {
            existing.remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };

    DeroNFTApp.prototype.hideCollectionScanResults = function() {
        const modal = document.getElementById('collectionScanModal');
        if (modal) {
            modal.remove();
        }
    };

    /* ------------------------------------------------------------------
     * Ownership Update and Utility Functions
     * Moved from appcore.js to reduce file size
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.decodeHexString = function(hexStr) {
        if (!hexStr || typeof hexStr !== 'string') return hexStr;
        const trimmed = hexStr.trim();
        if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length > 2) {
            try {
                let result = '';
                for (let i = 0; i < trimmed.length; i += 2) {
                    result += String.fromCharCode(parseInt(trimmed.substr(i, 2), 16));
                }
                return result;
            } catch (error) {
                return hexStr;
            }
        }
        return hexStr;
    };

    DeroNFTApp.prototype.sanitizePrintableString = function(value, options = {}) {
        if (typeof value !== 'string') {
            return value;
        }
        const { collapseWhitespace = true } = options;
        let sanitized = value.replace(/[\u0000-\u001F]+/g, ' ');
        if (collapseWhitespace) {
            sanitized = sanitized.replace(/\s+/g, ' ').trim();
        }
        return sanitized;
    };

    DeroNFTApp.prototype.applyOwnershipUpdateFromAction = function(scid, tokenId, status) {
        if (!scid || !status) return;
        this.setOwnershipOverride(scid, tokenId, status);

        const matchKeys = this.normalizeAssetMatchKeys({ scid, tokenId });
        const applyStatus = (asset) => {
            if (!asset || !this.matchesAssetKeys(asset, matchKeys)) return false;
            asset.ownershipStatus = status;
            asset.owned = status === 'owned' || status === 'displayed';
            asset.displayed = status === 'displayed';
            asset.inContract = status === 'in-contract';
            if (status === 'not-owned') {
                asset.owned = false;
                asset.displayed = false;
            }
            return true;
        };

        const updateList = (list) => {
            if (!Array.isArray(list)) return false;
            let changed = false;
            list.forEach(asset => {
                if (applyStatus(asset)) changed = true;
            });
            return changed;
        };

        let changed = false;
        changed = updateList(this.savedAssets) || changed;
        if (this.assetsCache?.value) {
            if (Array.isArray(this.assetsCache.value)) {
                changed = updateList(this.assetsCache.value) || changed;
            } else if (Array.isArray(this.assetsCache.value.nfts)) {
                changed = updateList(this.assetsCache.value.nfts) || changed;
            }
        }
        changed = updateList(this.lastSearchResults) || changed;
        changed = updateList(this.lastCollectionResults) || changed;

        if (changed) {
            if (this.currentTab === 'view' && this.assetsCache?.value && this.renderAssetsWithOrders) {
                this.renderAssetsWithOrders(this.assetsCache.value);
            } else if (this.currentTab === 'search' && Array.isArray(this.lastSearchResults) && this.renderSearchResults) {
                this.renderSearchResults(this.lastSearchResults);
            }
        }
    };

    DeroNFTApp.prototype.refreshSavedAssets = async function() {
        if (!Array.isArray(this.savedAssets) || this.savedAssets.length === 0) {
            this.showNotification?.('No saved assets to refresh yet.', 'info');
            return;
        }
        if (!this.currentAddress || !this.deroWallet || !this.deroWallet.ws) {
            this.showError?.('Connect your Engram wallet to refresh saved assets from on-chain data.');
            return;
        }

        const nonCollections = this.savedAssets.filter(asset => !(this.isCollectionAsset && this.isCollectionAsset(asset)));
        if (nonCollections.length === 0) {
            this.showNotification?.('Only collection contracts are saved. Nothing to refresh.', 'info');
            return;
        }

        this.showLoading?.('loadingAssets');
        try {
            for (const asset of nonCollections) {
                if (!asset || !asset.scid) {
                    continue;
                }
                try {
                    const status = await this.determineOwnershipStatusForAssetFresh(asset, asset.collection_scid || asset.scid);
                    asset.ownershipStatus = status;
                    asset.owned = status === 'owned' || status === 'displayed';
                    asset.displayed = status === 'displayed';
                    asset.inContract = status === 'in-contract';
                } catch (error) {
                }
            }
            this.saveAssets?.();
            await this.loadAssets?.(true);
            this.showSuccess?.('Saved NFTs/NFAs refreshed from on-chain data.');
        } catch (error) {
            this.showError?.(`Failed to refresh saved assets: ${error.message}`);
        } finally {
            this.hideLoading?.('loadingAssets');
        }
    };

    /* ------------------------------------------------------------------
     * Asset Management Functions
     * Moved from appcore.js to reduce file size
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.loadSavedAssets = function() {
        try {
            const saved = localStorage.getItem(this.savedAssetsKey);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (error) {
        }
        return [];
    };

    DeroNFTApp.prototype.saveAssets = function() {
        try {
            localStorage.setItem(this.savedAssetsKey, JSON.stringify(this.savedAssets));
        } catch (error) {
        }
    };

    DeroNFTApp.prototype.primeCachedAssetsFromSaved = function(renderImmediately = false) {
        const savedList = Array.isArray(this.savedAssets) ? [...this.savedAssets] : [];
        this.assetsCache = {
            value: { nfts: savedList, nfas: [], orders: [] },
            timestamp: Date.now()
        };
        if (renderImmediately && typeof this.renderAssetsWithOrders === 'function') {
            this.renderAssetsWithOrders(this.assetsCache.value);
        }
    };

    DeroNFTApp.prototype.loadAssets = async function(forceRefresh = false) {
        // Always load from localStorage if savedAssets is empty or if forceRefresh is true
        // Check if savedAssets is empty array (initialized but not loaded) or if it needs refresh
        const isEmpty = !Array.isArray(this.savedAssets) || this.savedAssets.length === 0;
        if (isEmpty || forceRefresh) {
            const loaded = this.loadSavedAssets();
            if (Array.isArray(loaded)) {
                this.savedAssets = loaded;
            }
        }
        this.primeCachedAssetsFromSaved(false);
        if (typeof this.renderAssetsWithOrders === 'function') {
            this.renderAssetsWithOrders(this.assetsCache.value);
        }
    };

    /* ------------------------------------------------------------------
     * Simple-Gnomon Integration
     * Scans simple-gnomon indexer for all owned NFT/NFA assets
     * ------------------------------------------------------------------ */
}

// Initialize savedAssets after appfeat4.js loads (loadSavedAssets is defined here)
if (typeof window !== 'undefined') {
    setTimeout(() => {
        if (window.app && typeof window.app.loadSavedAssets === 'function') {
            // Always load from localStorage on page load (savedAssets might be initialized as empty array)
            const loadedAssets = window.app.loadSavedAssets();
            if (Array.isArray(loadedAssets) && loadedAssets.length > 0) {
                window.app.savedAssets = loadedAssets;
                // Prime cache with loaded assets
                if (window.app.primeCachedAssetsFromSaved) {
                    window.app.primeCachedAssetsFromSaved(false);
                }
                // If on view tab, render the assets
                if (window.app.currentTab === 'view' && window.app.renderAssetsWithOrders && window.app.assetsCache && window.app.assetsCache.value) {
                    window.app.renderAssetsWithOrders(window.app.assetsCache.value);
                }
            } else if (Array.isArray(loadedAssets)) {
                // Even if empty, set it to ensure consistency
                window.app.savedAssets = loadedAssets;
                // Prime cache
                if (window.app.primeCachedAssetsFromSaved) {
                    window.app.primeCachedAssetsFromSaved(false);
                }
            }
        }
    }, 100);
}


