if (typeof DeroNFTApp !== 'undefined') {
    /* ------------------------------------------------------------------
     * Collection and asset query functions
     * Moved from appfeat4.js to reduce file size
     * Artificer marketplace functions moved to appfeat8.js
     * ------------------------------------------------------------------ */
    DeroNFTApp.prototype.queryAssetBySCID = async function(scid, options = {}) {
        try {
            if (!this.deroWallet || !this.deroWallet.ws || !this.deroWallet.ws.getSC) {
                const error = new Error('Wallet not connected');
                throw error;
            }
            
            // Validate SCID format
            if (!scid || scid.length !== 64 || !/^[0-9a-f]{64}$/i.test(scid)) {
                const error = new Error('Invalid SCID format');
                throw error;
            }

            if (!this.g45Cache) this.g45Cache = new Map();
            if (!options.forceRefresh && this.g45Cache.has(scid)) {
                return this.g45Cache.get(scid);
            }

            let scResult;
            try {
                scResult = await this.deroWallet.ws.getSC(scid);
            } catch (getSCError) {
                // DERO.GetSC failed
                return { error: true, scid: scid, errorMessage: getSCError?.message || 'DERO.GetSC failed' };
            }
            
            if (!scResult) {
                return { error: true, scid: scid, errorMessage: 'No result from DERO.GetSC' };
            }

            // Get stringkeys - handle both direct response and nested result structure
            const result = scResult.result || scResult;
            if (!result || (typeof result !== 'object')) {
                return { error: true, scid: scid, errorMessage: 'Invalid result structure from DERO.GetSC' };
            }
            const keys = (result && result.stringkeys) ? result.stringkeys : (scResult.stringkeys || {});
            if (!keys || (typeof keys !== 'object') || Object.keys(keys).length === 0) {
                // Return minimal asset object instead of null to prevent crashes
                return {
                    scid: scid,
                    name: `Unknown Asset (${scid.substring(0, 8)}...)`,
                    image: '/images/placeholder.png',
                    type: 'Unknown',
                    error: false,
                    noMetadata: true
                };
            }

            const sanitize = this.sanitizePrintableString || ((v) => v);
            const decode = this.decodeHexString || ((v) => v);
            
            // Decode type, name, symbol, metadata
            let contractType = null;
            if (keys.type) {
                try {
                    contractType = decode(keys.type);
                    // Clean up decoded type (remove nulls, trim whitespace)
                    if (contractType) {
                        contractType = contractType.replace(/\0/g, '').trim();
                    }
                } catch (e) {
                    contractType = keys.type;
                }
            }
            
            // Also check metadata for type if not found in stringkeys
            if (!contractType && result.metadata) {
                try {
                    const metaStr = typeof result.metadata === 'string' ? result.metadata : decode(result.metadata);
                    const meta = JSON.parse(metaStr);
                    if (meta.type) contractType = meta.type;
                } catch (e) {}
            }
            
            // For NFAs, check additional key names that might contain name/image
            // NFAs might use different key names like 'assetName', 'asset_name', 'title', etc.
            // Also check hex-encoded keys by decoding all keys first
            let name = keys.name ? (this.decodeHexString ? sanitize(decode(keys.name)) : sanitize(keys.name)) : null;
            if (!name) {
                // Try alternative NFA key names
                const altNameKeys = ['assetName', 'asset_name', 'title', 'Title', 'nftName', 'nft_name', 'Name', 'NAME'];
                for (const key of altNameKeys) {
                    if (keys[key]) {
                        name = this.decodeHexString ? sanitize(decode(keys[key])) : sanitize(keys[key]);
                        if (name && name.trim().length > 0) break;
                    }
                }
            }
            
            // If still no name, check all keys for hex-encoded name values
            if (!name || name.trim().length === 0) {
                for (const [rawKey, rawValue] of Object.entries(keys)) {
                    const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                    if (!decodedKey) continue;
                    const normalizedKey = decodedKey.toLowerCase();
                    
                    // Check if this key might contain a name
                    if (normalizedKey.includes('name') || normalizedKey.includes('title')) {
                        try {
                            const decodedValue = this.decodeHexString ? sanitize(decode(rawValue)) : sanitize(rawValue);
                            if (decodedValue && decodedValue.trim().length > 0 && decodedValue.length < 200) {
                                // Likely a name if it's a reasonable length and not hex
                                if (!/^[0-9a-f]{64}$/i.test(decodedValue.trim())) {
                                    name = decodedValue.trim();
                                    break;
                                }
                            }
                        } catch (e) {
                            // Ignore decode errors
                        }
                    }
                }
            }
            
            const symbol = keys.symbol ? (this.decodeHexString ? sanitize(decode(keys.symbol)) : sanitize(keys.symbol)) : null;
            
            // Get metadata from stringkeys or result
            // Check multiple possible metadata key names
            let metadata = null;
            const metadataKeys = ['metadata', 'Metadata', 'METADATA', 'meta', 'Meta', 'data', 'Data'];
            let metadataRaw = null;
            
            for (const key of metadataKeys) {
                if (keys[key]) {
                    metadataRaw = keys[key];
                    break;
                }
            }
            
            // Fall back to result.metadata if not found in keys
            if (!metadataRaw && result.metadata) {
                metadataRaw = result.metadata;
            }
            
            if (metadataRaw) {
                try {
                    const raw = metadataRaw;
                    if (typeof raw === 'string' && /^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0 && raw.length > 2) {
                        metadata = sanitize(decode(raw), { collapseWhitespace: false });
                    } else {
                        metadata = sanitize(raw, { collapseWhitespace: false });
                    }
                } catch (e) {
                    // If decoding fails, try using raw value
                    metadata = typeof metadataRaw === 'string' ? metadataRaw : String(metadataRaw);
                }
            }
            
            // If still no metadata, check all keys for hex-encoded JSON metadata
            if (!metadata) {
                for (const [rawKey, rawValue] of Object.entries(keys)) {
                    const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                    if (!decodedKey) continue;
                    const normalizedKey = decodedKey.toLowerCase();
                    
                    // Check if this key might contain metadata
                    if (normalizedKey.includes('metadata') || normalizedKey.includes('meta') || normalizedKey.includes('data')) {
                        try {
                            const decodedValue = this.decodeHexString ? decode(rawValue) : rawValue;
                            if (decodedValue && typeof decodedValue === 'string' && decodedValue.trim().startsWith('{')) {
                                // Looks like JSON metadata
                                metadata = sanitize(decodedValue, { collapseWhitespace: false });
                                break;
                            }
                        } catch (e) {
                            // Ignore decode errors
                        }
                    }
                }
            }

            // Parse metadata JSON for image/description
            let image = null;
            let description = null;
            let assetName = name || `Asset ${scid.substring(0, 8)}...`;
            
            // For NFAs, also check direct image keys
            if (!image) {
                const imageKeys = ['image', 'Image', 'assetImage', 'asset_image', 'url', 'URL', 'uri', 'URI', 'imageUrl', 'image_url', 'ImageURL'];
                for (const key of imageKeys) {
                    if (keys[key]) {
                        const imgValue = this.decodeHexString ? sanitize(decode(keys[key])) : sanitize(keys[key]);
                        if (imgValue && (imgValue.startsWith('http') || imgValue.startsWith('ipfs') || imgValue.startsWith('/') || imgValue.startsWith('data:'))) {
                            image = imgValue;
                            break;
                        }
                    }
                }
            }
            
            // If still no image, check all keys for hex-encoded image URLs
            if (!image) {
                for (const [rawKey, rawValue] of Object.entries(keys)) {
                    const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                    if (!decodedKey) continue;
                    const normalizedKey = decodedKey.toLowerCase();
                    
                    // Check if this key might contain an image URL
                    if (normalizedKey.includes('image') || normalizedKey.includes('url') || normalizedKey.includes('uri')) {
                        try {
                            const decodedValue = this.decodeHexString ? sanitize(decode(rawValue)) : sanitize(rawValue);
                            if (decodedValue && (decodedValue.startsWith('http') || decodedValue.startsWith('ipfs') || decodedValue.startsWith('/') || decodedValue.startsWith('data:'))) {
                                image = decodedValue;
                                break;
                            }
                        } catch (e) {
                            // Ignore decode errors
                        }
                    }
                }
            }
            
            if (metadata) {
                try {
                    const json = JSON.parse(metadata);
                    if (json.image) image = json.image;
                    if (json.name) assetName = json.name;
                    if (json.description) description = json.description;
                    // Also check for NFA-specific metadata fields
                    if (!image && json.url) image = json.url;
                    if (!image && json.uri) image = json.uri;
                    if (!image && json.imageUrl) image = json.imageUrl;
                } catch (e) {}
            }

            // Decode collection - check both 'collection' key and 'collection_scid' key
            let collectionName = null;
            let collectionScid = null;
            
            // Check 'collection' key first
            if (keys.collection) {
                const col = this.decodeHexString ? sanitize(decode(keys.collection), { collapseWhitespace: true }) : sanitize(keys.collection, { collapseWhitespace: true });
                if (col && /^[0-9a-fA-F]{64}$/.test(col)) {
                    collectionScid = col.toLowerCase();
                } else if (col) {
                    collectionName = col;
                }
            }
            
            // Also check 'collection_scid' key (some NFTs store it this way)
            if (!collectionScid && keys.collection_scid) {
                const colScid = this.decodeHexString ? sanitize(decode(keys.collection_scid), { collapseWhitespace: true }) : sanitize(keys.collection_scid, { collapseWhitespace: true });
                if (colScid && /^[0-9a-fA-F]{64}$/.test(colScid)) {
                    collectionScid = colScid.toLowerCase();
                }
            }
            
            // Also check keys directly for collection_scid (might be stored as hex)
            if (!collectionScid && keys) {
                for (const [rawKey, rawValue] of Object.entries(keys)) {
                    const decodedKey = this.decodeHexString ? this.decodeHexString(rawKey) : rawKey;
                    if (!decodedKey) continue;
                    const normalizedKey = decodedKey.toLowerCase();
                    
                    if (normalizedKey === 'collection_scid' || normalizedKey === 'collection') {
                        const colValue = this.decodeHexString ? sanitize(decode(rawValue), { collapseWhitespace: true }) : sanitize(rawValue, { collapseWhitespace: true });
                        if (colValue && /^[0-9a-fA-F]{64}$/.test(colValue)) {
                            collectionScid = colValue.toLowerCase();
                            break;
                        }
                    }
                }
            }

            // Determine type - also check for collection via code or other indicators
            // Check contractType, metadataFormat, and type field for NFA indicators
            const metadataFormat = keys.metadataFormat ? (this.decodeHexString ? sanitize(decode(keys.metadataFormat)) : sanitize(keys.metadataFormat)) : null;
            const typeField = keys.type ? (this.decodeHexString ? sanitize(decode(keys.type)) : sanitize(keys.type)) : null;
            const isNFA = (contractType && (contractType.includes('NFA') || contractType.includes('MS1') || contractType === 'T345' || contractType.includes('ART-NFA'))) ||
                         (metadataFormat && (metadataFormat.includes('NFA') || metadataFormat.includes('MS1') || metadataFormat.includes('ART-NFA'))) ||
                         (typeField && (typeField.includes('NFA') || typeField.includes('MS1') || typeField === 'T345' || typeField.includes('ART-NFA')));
            
            // Check if collection: type is G45-C, or contract code indicates collection, or has SetAssets function
            // Check contract code for SetAssets function (indicates G45-C collection)
            const contractCode = result.code || scResult.code || keys.code || '';
            let decodedCode = '';
            if (contractCode) {
                try {
                    if (typeof contractCode === 'string' && /^[0-9a-fA-F]+$/.test(contractCode)) {
                        decodedCode = this.decodeHexString ? this.decodeHexString(contractCode) : contractCode;
                    } else if (typeof contractCode === 'string') {
                        decodedCode = contractCode;
                    }
                } catch (e) {
                }
            }
            
            // Check for SetAssets function in code (G45-C collections have this)
            const hasSetAssets = decodedCode && (decodedCode.includes('SetAssets') || decodedCode.includes('Function SetAssets'));
            // Also check if type is G45-C (case-insensitive, trimmed)
            const normalizedType = contractType ? contractType.trim().toUpperCase() : '';
            // NFA collections don't use G45-C standard, but might have collection indicators
            // For now, only G45-C is treated as collection
            const isCollection = normalizedType === 'G45-C' || 
                                 (contractType && contractType.trim() === 'G45-C') ||
                                 (contractType === 'G45-AT' && hasSetAssets) || 
                                 (hasSetAssets && !isNFA);
            
            const type = isCollection ? 'Collection' : (isNFA ? 'NFA' : 'NFT');

            const asset = {
                id: scid,
                scid: scid,
                name: assetName,
                symbol: symbol || (isNFA ? 'NFA-MS1' : 'G45-AT'),
                type: type,
                isCollection: isCollection,
                image: image || (this.getPlaceholderImage ? this.getPlaceholderImage() : ''),
                description: description || 'Asset from smart contract',
                collection_name: collectionName,
                collection_scid: collectionScid,
                contractType: contractType,
                metadata: metadata,
                metadataFormat: keys.metadataFormat ? (this.decodeHexString ? sanitize(decode(keys.metadataFormat)) : keys.metadataFormat) : null,
                minter: keys.minter ? (this.decodeHexString ? decode(keys.minter) : keys.minter) : null,
                owner: keys.owner ? (this.decodeHexString ? decode(keys.owner) : keys.owner) : null,
                stringkeys: keys,
                balances: scResult.balances || scResult.result?.balances || {}
            };

            this.g45Cache.set(scid, asset);
            return asset;
        } catch (error) {
            if (error.message && error.message.includes('Wallet not connected')) {
                throw error;
            }
            
            // Return error object instead of null to prevent crashes
            return {
                error: true,
                scid: scid,
                errorMessage: error?.message || 'Unknown error',
                name: `Error: ${scid?.substring(0, 8)}...`,
                image: '/images/placeholder.png',
                type: 'Error'
            };
        }
    }

    // Backward compatibility alias
    DeroNFTApp.prototype.queryG45AT = DeroNFTApp.prototype.queryAssetBySCID;

    /* ------------------------------------------------------------------
     * Collection viewing functions (moved from appfeat4.js)
     * ------------------------------------------------------------------ */

    DeroNFTApp.prototype.viewCollectionNFTs = async function(scid) {
        // Normalize SCID to lowercase
        const normalizedScid = scid ? scid.toLowerCase().trim() : scid;
        
        this.showLoading('loadingSearch');
        
        try {
            // First check if collection is saved and has stored NFTs
            let collectionAsset = this.findAssetByScid ? this.findAssetByScid(normalizedScid) : null;
            let collectionName = '';
            let collectionAssets = [];
            
            // If collection is saved and has stored NFTs, use those first
            if (collectionAsset && collectionAsset.collectionNFTs && Array.isArray(collectionAsset.collectionNFTs) && collectionAsset.collectionNFTs.length > 0) {
                collectionAssets = collectionAsset.collectionNFTs;
                collectionName = collectionAsset.name || collectionAsset.collection_name || `Collection ${normalizedScid.substring(0, 8)}...`;
            } else {
                // Try to get collection metadata (for display name)
                try {
            if (!collectionAsset && this.queryG45AT) {
                collectionAsset = await this.queryG45AT(normalizedScid);
            }
                    collectionName = collectionAsset?.name || collectionAsset?.collection_name || `Collection ${normalizedScid.substring(0, 8)}...`;
                } catch (metaError) {
                    collectionName = `Collection ${normalizedScid.substring(0, 8)}...`;
                }
                
                // Query from chain if no stored NFTs
            if (this.queryAllCollectionNFTs) {
                    try {
                collectionAssets = await this.queryAllCollectionNFTs(normalizedScid);
                    } catch (queryError) {
            }
                }
                
            // If chain query failed or returned empty, try loadCollectionFromChain
            if ((!collectionAssets || collectionAssets.length === 0) && this.loadCollectionFromChain) {
                    try {
                collectionAssets = await this.loadCollectionFromChain(normalizedScid);
                    } catch (loadError) {
                    }
                }
                
                // If still no assets, check saved assets for NFTs with this collection_scid
                // This handles the case where NFTs are manually added with collection_scid
                if ((!collectionAssets || collectionAssets.length === 0) && this.savedAssets && Array.isArray(this.savedAssets)) {
                    const savedCollectionNFTs = this.savedAssets.filter(asset => {
                        if (!asset || asset.isCollection) return false;
                        const assetCollectionScid = (asset.collection_scid || '').toLowerCase();
                        return assetCollectionScid === normalizedScid;
                    });
                    if (savedCollectionNFTs.length > 0) {
                        collectionAssets = savedCollectionNFTs;
                    }
                }
            }
            
            // Ensure all assets have collection_scid and collection_name set
            collectionAssets = (collectionAssets || []).map(asset => ({
                ...asset,
                collection_scid: normalizedScid,
                collection_name: collectionName
            }));
            
            // Last resort: fall back to cached assets (but only if on-chain query completely failed)
            if ((!collectionAssets || collectionAssets.length === 0)) {
                const cachedAssets = this.getCollectionAssets ? this.getCollectionAssets(normalizedScid, collectionName) : [];
                if (cachedAssets && cachedAssets.length > 0) {
                    collectionAssets = cachedAssets.map(asset => ({
                        ...asset,
                        collection_scid: normalizedScid,
                        collection_name: collectionName
                    }));
            }
            }
            
            this.lastCollectionResults = collectionAssets || [];
            
            if (collectionAssets && collectionAssets.length > 0) {
                this.showCollectionModal(normalizedScid, collectionAssets, collectionName);
            } else {
                this.showNotification('No NFTs found in this collection. The collection might be empty or the query failed. Check the browser console for details.', 'info');
            }
        } catch (error) {
            this.showError(`Failed to load collection NFTs: ${error.message}`);
        } finally {
            this.hideLoading('loadingSearch');
        }
    };

    DeroNFTApp.prototype.loadCollectionFromChain = async function(collectionScid) {
        if (!collectionScid) {
            return [];
        }
        const normalizedCollectionScid = collectionScid.toLowerCase().trim();
            const assets = [];
        
        // Method 1: Try to get SCIDs from collection contract
        if (this.fetchCollectionAssetScidsFromContract) {
            try {
                const childScids = await this.fetchCollectionAssetScidsFromContract(normalizedCollectionScid);
                if (Array.isArray(childScids) && childScids.length > 0) {
            for (const childScid of childScids) {
                if (!childScid) continue;
                try {
                    const queryFn = this.queryAssetBySCID || this.queryG45AT;
                    const nft = queryFn ? await queryFn(childScid, { forceRefresh: true }) : null;
                            if (nft && !nft.error) {
                                // Verify this NFT actually belongs to the collection
                                const nftCollectionScid = (nft.collection_scid || '').toLowerCase();
                                if (nftCollectionScid === normalizedCollectionScid || !nftCollectionScid) {
                                    nft.collection_scid = normalizedCollectionScid;
                        assets.push(nft);
                                }
                    }
                } catch (error) {
                            // Ignore individual NFT query errors
                }
            }
                }
        } catch (error) {
                // Ignore collection SCID fetch errors
            }
        }
        
        // Method 2: If no assets found and we have saved assets, check if any have this collection_scid
        // This helps when NFTs are manually added with collection_scid but not stored in collection contract
        if (assets.length === 0 && this.savedAssets && Array.isArray(this.savedAssets)) {
            const savedCollectionNFTs = this.savedAssets.filter(asset => {
                if (!asset || asset.isCollection) return false;
                const assetCollectionScid = (asset.collection_scid || '').toLowerCase();
                return assetCollectionScid === normalizedCollectionScid;
            });
            if (savedCollectionNFTs.length > 0) {
                assets.push(...savedCollectionNFTs);
            }
        }
        
        return assets;
    };

    DeroNFTApp.prototype.queryAllCollectionNFTs = async function(scid) {
        if (!scid) {
            return [];
        }

        // Query from chain using DERO.GetSC - get TotalSupply and query all tokens
        // This replaces the old GetTransfers approach
        try {
            if (!this.deroWallet || !this.deroWallet.ws) {
                return [];
            }

            // Get TotalSupply from collection contract
            let totalSupply = 0;
            try {
                const scState = await this.deroWallet.ws.getSC(scid, false, true);
                if (!scState) {
                    return [];
                }
                const scData = scState?.result || scState;
                if (!scData || (typeof scData !== 'object')) {
                    return [];
                }
                const uint64Keys = (scData && scData.uint64keys) ? scData.uint64keys : {};
                const stringKeys = (scData && scData.stringkeys) ? scData.stringkeys : {};
                
                if (uint64Keys['TotalSupply'] !== undefined) {
                    totalSupply = parseInt(uint64Keys['TotalSupply'], 10) || 0;
                } else if (uint64Keys['totalSupply'] !== undefined) {
                    totalSupply = parseInt(uint64Keys['totalSupply'], 10) || 0;
                } else if (stringKeys['TotalSupply']) {
                    totalSupply = parseInt(stringKeys['TotalSupply'], 10) || 0;
                } else {
                    // Try function call
                    try {
                        const totalSupplyResult = await this.deroWallet.ws.getSC(scid, 'TotalSupply', []);
                        if (totalSupplyResult && !totalSupplyResult.error && totalSupplyResult.result) {
                            const supply = this.deroWallet.ws.extractValue ? this.deroWallet.ws.extractValue(totalSupplyResult) : null;
                            if (supply) {
                                totalSupply = parseInt(supply, 10) || 0;
                            }
                        }
                    } catch (e) {
                        // Function call failed, try single-SCID collection
                    }
                }
            } catch (e) {
                // Ignore TotalSupply errors
            }

            const assets = [];
            
            // If TotalSupply > 0, this is a token-based collection (each token has a tokenId)
            if (totalSupply > 0) {
                const maxTokens = Math.min(totalSupply, 500);
                for (let tokenId = 1; tokenId <= maxTokens; tokenId++) {
                    try {
                        // Query TokenURI for each token
                        let tokenUri = null;
                        try {
                            const uriResult = await this.deroWallet.ws.getSC(scid, 'TokenURI', [{
                                name: 'token_id',
                                datatype: 'U',
                                value: tokenId
                            }]);
                            if (uriResult && !uriResult.error && uriResult.result) {
                                tokenUri = this.deroWallet.ws.extractValue ? this.deroWallet.ws.extractValue(uriResult) : null;
                            }
                        } catch (e) {
                            // TokenURI not available, skip
                        }

                        const asset = {
                            id: `${scid}_${tokenId}`,
                            scid: scid.toLowerCase(),
                            tokenId: tokenId,
                            name: `NFT #${tokenId}`,
                            type: 'NFT',
                            image: tokenUri || './images/placeholder.png',
                            description: `Token ID: ${tokenId}`,
                            collection_scid: scid.toLowerCase()
                        };

                        // Enrich with G45 data if available
                        if (this.enrichAssetWithG45) {
                            try {
                                const enriched = await this.enrichAssetWithG45(asset);
                                assets.push(enriched || asset);
                            } catch (enrichError) {
                                assets.push(asset);
                            }
                        } else {
                            assets.push(asset);
                        }
                    } catch (tokenError) {
                        // Ignore individual token errors
                    }
                }
            } else {
                // Single-SCID collection - each NFT has its own SCID
                if (this.fetchCollectionAssetScidsFromContract) {
                    try {
                        const assetScids = await this.fetchCollectionAssetScidsFromContract(scid);
                        for (const assetScid of assetScids) {
                            try {
                                const assetData = await this.queryAssetBySCID ? await this.queryAssetBySCID(assetScid, { forceRefresh: true }) : null;
                                if (assetData && !assetData.error) {
                                    // Filter out non-NFT assets - only include valid NFTs/NFAs
                                    const isNFT = this.isG45Asset ? this.isG45Asset(assetData) : false;
                                    const isNFA = this.isArtificerAsset ? this.isArtificerAsset(assetData) : false;
                                    if (isNFT || isNFA) {
                                    assetData.collection_scid = scid.toLowerCase();
                                    if (this.enrichAssetWithG45) {
                                        try {
                                            const enriched = await this.enrichAssetWithG45(assetData);
                                            assets.push(enriched || assetData);
                                        } catch (enrichError) {
                                            assets.push(assetData);
                                        }
                                    } else {
                                        assets.push(assetData);
                                        }
                                    }
                                }
                            } catch (assetError) {
                                // Ignore individual asset errors
                            }
                        }
                    } catch (fetchError) {
                        // Ignore fetch errors
                    }
                }
            }

            if (assets.length > 0) {
                return assets;
            }
        } catch (error) {
            // Ignore query errors, fall back to cached assets
        }

        // Fallback to cached/saved assets if chain query failed
        const cached = this.getCollectionAssets ? this.getCollectionAssets(scid) : [];
        if (cached && cached.length > 0) {
            return cached;
        }

        const savedMatches = (this.savedAssets || []).filter(asset => {
            return asset.collection_scid === scid || asset.scid === scid;
        });
        if (savedMatches.length > 0) {
            return savedMatches;
        }

        return [];
    };

    /* ------------------------------------------------------------------
     * Collection Modal Functions
     * Moved to appfeat7.js to reduce file size
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------
     * Marketplace Configuration Functions
     * Moved to appfeat7.js to reduce file size
     * ------------------------------------------------------------------ */

}

// Wallet Calls Test Functions - NFA Status Query
// Moved from index.js to appfeat6.js

// Test Query NFA Status - define function first
async function testQueryNFAStatus() {
    if (!window.checkWalletConnection || !window.checkWalletConnection()) return;
    
    try {
        const scid = document.getElementById('nfaStatusScid').value.trim();
        
        if (!scid || scid.length !== 64) {
            alert('Invalid NFA SCID. Must be 64 hex characters.');
            return;
        }

        if (window.logEngramResponse) {
            window.logEngramResponse({ method: 'Query NFA Status', params: { scid }, status: 'querying...' });
        }
        
        // Get contract state
        const scResult = await window.app.deroWallet.ws.getSC(scid);
        const scData = scResult?.result || scResult;
        const stringKeys = scData?.stringkeys || {};
        const uint64Keys = scData?.uint64keys || {};
        
        // Helper function to decode hex strings (addresses are often hex-encoded)
        const decodeHex = (hexStr) => {
            if (!hexStr) return '';
            
            // If it's already an integrated address, return it
            if (typeof hexStr === 'string' && (hexStr.toLowerCase().startsWith('dero1') || hexStr.toLowerCase().startsWith('deto1'))) {
                return hexStr;
            }
            
            try {
                // Try using app's decodeHexString first (most reliable)
                if (window.app && window.app.decodeHexString) {
                    const appDecoded = window.app.decodeHexString(hexStr);
                    if (appDecoded && typeof appDecoded === 'string') {
                        // If it decoded to an address, return it
                        if (appDecoded.toLowerCase().startsWith('dero1') || appDecoded.toLowerCase().startsWith('deto1')) {
                            return appDecoded;
                        }
                        // If it decoded to something printable, return it
                        if (appDecoded.length > 0 && appDecoded.length < 200) {
                            return appDecoded;
                        }
                    }
                }
                
                // Try manual hex decoding for ASCII strings
                if (typeof hexStr === 'string' && /^[0-9a-fA-F]+$/.test(hexStr) && hexStr.length % 2 === 0) {
                    let decoded = '';
                    for (let i = 0; i < hexStr.length; i += 2) {
                        const hex = hexStr.substr(i, 2);
                        const charCode = parseInt(hex, 16);
                        if (charCode >= 32 && charCode <= 126) { // Printable ASCII
                            decoded += String.fromCharCode(charCode);
                        } else if (charCode === 0) {
                            // Null terminator - stop here
                            break;
                        } else {
                            // Not printable ASCII - this might be binary data (public key)
                            // Return hex format for display
                            return hexStr;
                        }
                    }
                    // If we got a reasonable decoded string, return it
                    if (decoded.length > 0 && decoded.length < 200) {
                        return decoded;
                    }
                }
                
                // If all else fails, return the raw value (might already be decoded)
                return hexStr;
            } catch (e) {
                return hexStr;
            }
        };
        
        // Helper functions
        const decS = (key) => {
            const raw = stringKeys[key];
            if (!raw) return '';
            // Try multiple decoding methods
            let decoded = decodeHex(raw);
            if (window.app.decodeHexString && decoded === raw) {
                decoded = window.app.decodeHexString(raw) || raw;
            }
            return decoded;
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
        
        // Extract NFA state
        const ownerRaw = stringKeys['owner'] || '';
        let owner = decS('owner');
        
        // If owner is still hex-encoded (66 chars = 33 bytes = public key), try to format it better
        if (ownerRaw && ownerRaw.length === 66 && /^[0-9a-fA-F]+$/.test(ownerRaw)) {
            // This is likely a raw public key in hex format
            // We can't convert it to integrated address without crypto libraries,
            // but we can at least show it clearly
            owner = ownerRaw; // Keep as hex for now
        } else if (ownerRaw && typeof ownerRaw === 'string' && ownerRaw.length > 0) {
            // Try one more time with the raw value
            owner = decodeHex(ownerRaw);
        }
        
        const active = decU('active');
        const scBalance = decU('scBalance');
        const listType = decS('listType');
        const startPrice = decU('startPrice');
        const buyNowPrice = decU('buyNowPrice');
        const reservePrice = decU('reservePrice');
        const startBlockTime = decU('startBlockTime');
        const endBlockTime = decU('endBlockTime');
        const cancelBuffer = decU('cancelBuffer');
        const currentOwner = decS('currentOwner') || owner;
        const minter = decS('minter');
        
        // Improved address matching - handle hex-encoded addresses and different formats
        const currentAddress = window.app.currentAddress || '';
        const normalizeAddress = (addr) => {
            if (!addr) return '';
            const lower = addr.toLowerCase();
            // Remove dero1/deto1 prefix and get base
            return lower.replace(/^(dero1|deto1)/, '');
        };
        
        const addressMatches = (addr1, addr2) => {
            if (!addr1 || !addr2) return false;
            const a1 = addr1.toLowerCase();
            const a2 = addr2.toLowerCase();
            // Exact match
            if (a1 === a2) return true;
            // Match without prefix
            const base1 = normalizeAddress(a1);
            const base2 = normalizeAddress(a2);
            if (base1 && base2 && base1 === base2) return true;
            // Match first 50 characters (addresses can vary in length)
            if (a1.substring(0, 50) === a2.substring(0, 50)) return true;
            return false;
        };
        
        const isOwner = owner && currentAddress && addressMatches(owner, currentAddress);
        
        // Determine status (more lenient to catch pending listings)
        let status = 'unknown';
        if (active === 1 && scBalance === 1 && (listType === 'sale' || listType === 'auction')) {
            status = 'active_listing';
        } else if (isOwner && scBalance > 0 && (listType === 'sale' || listType === 'auction')) {
            // Owner has escrowed balance and listing data - likely pending confirmation
            status = 'pending_listing';
        } else if (isOwner && scBalance > 0) {
            // Escrowed but might not have listing data yet
            status = 'escrowed_pending';
        } else if (scBalance > 0 && (listType === 'sale' || listType === 'auction')) {
            // Escrowed with listing data - active listing (owner check might fail due to address format)
            status = 'active_listing';
        } else if (scBalance > 0) {
            status = 'escrowed';
        } else if (isOwner && (listType === 'sale' || listType === 'auction')) {
            status = 'listed_but_not_active';
        } else if (isOwner) {
            status = 'owned_not_listed';
        } else if (owner) {
            status = 'owned_by_other';
        } else {
            status = 'no_owner';
        }
        
        // Can cancel if:
        // 1. Active listing (active === 1, scBalance === 1, listType is sale/auction)
        // 2. OR escrowed balance exists (scBalance > 0) - regardless of owner match (address format might differ)
        // 3. OR listing data exists (listType is sale/auction) - regardless of owner match
        const canCancel = (
            (active === 1 && scBalance === 1 && (listType === 'sale' || listType === 'auction')) ||
            (scBalance > 0) || // Escrowed - can cancel
            (listType === 'sale' || listType === 'auction') // Listing exists - can cancel
        );
        
        if (window.logEngramResponse) {
            window.logEngramResponse({
                method: 'Query NFA Status',
                params: { scid },
                nfaState: {
                    owner: owner,
                    ownerRaw: ownerRaw, // Raw hex value from contract
                    ownerHex: (ownerRaw && typeof ownerRaw === 'string' && /^[0-9a-fA-F]+$/.test(ownerRaw)) ? ownerRaw : '', // Clean hex if available
                    ownerDecoded: owner, // Decoded/processed address
                    ownerFormat: (ownerRaw && ownerRaw.length === 66 && /^[0-9a-fA-F]+$/.test(ownerRaw)) ? 'hex_public_key' : (owner && (owner.toLowerCase().startsWith('dero1') || owner.toLowerCase().startsWith('deto1'))) ? 'integrated_address' : 'unknown',
                    currentOwner: currentOwner || owner,
                    minter: minter,
                    active: active,
                    scBalance: scBalance,
                    listType: listType,
                    startPrice: startPrice,
                    buyNowPrice: buyNowPrice,
                    reservePrice: reservePrice,
                    startBlockTime: startBlockTime,
                    endBlockTime: endBlockTime,
                    cancelBuffer: cancelBuffer,
                    contractBalance: scData?.balance || 0,
                    contractBalances: scData?.balances || {}
                },
                walletInfo: {
                    currentAddress: currentAddress,
                    isOwner: isOwner,
                    ownerAddressNormalized: owner ? normalizeAddress(owner) : '',
                    currentAddressNormalized: currentAddress ? normalizeAddress(currentAddress) : ''
                },
                status: status,
                summary: {
                    status: status,
                    canCancel: canCancel,
                    isListed: (listType === 'sale' || listType === 'auction'),
                    isEscrowed: scBalance > 0,
                    isActive: active === 1,
                    ownerMatch: isOwner,
                    note: (function() {
                        if (!isOwner && owner) {
                            return 'Owner address format might differ. Check ownerRaw and ownerDecoded fields.';
                        }
                        if (status === 'active_listing') {
                            return 'NFA is actively listed for sale/auction';
                        } else if (status === 'pending_listing') {
                            return 'NFA listing is pending confirmation (escrowed + listing data found)';
                        } else if (status === 'escrowed_pending') {
                            return 'NFA balance is escrowed, listing may be pending confirmation';
                        } else if (status === 'escrowed') {
                            return 'NFA balance is escrowed in contract';
                        } else if (status === 'listed_but_not_active') {
                            return 'NFA has listing data but is not active (might be pending confirmation)';
                        } else if (status === 'owned_not_listed') {
                            return 'NFA is owned by you but not listed';
                        } else if (status === 'owned_by_other') {
                            return 'NFA is owned by another address';
                        }
                        return 'NFA status unknown';
                    })()
                }
            });
        }
    } catch (error) {
        if (window.logEngramResponse) {
            window.logEngramResponse({ 
                method: 'Query NFA Status', 
                error: error.message || error,
                stack: error.stack 
            });
        }
    }
}

// Expose globally - assign the actual function immediately
if (typeof window !== 'undefined') {
            window.testQueryNFAStatus = testQueryNFAStatus;
}

