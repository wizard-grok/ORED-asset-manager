if (typeof DeroNFTApp !== 'undefined') {

    DeroNFTApp.prototype.parseAssetsFromTransfers = async function(transfers) {
        if (!transfers || transfers.length === 0) {
            return [];
        }
        
        const nfts = [];
        const seenNFTs = new Set();
        const collectionSCIDs = new Set();
        let checkedCount = 0;
        
        for (const transfer of transfers) {
            checkedCount++;
            let scid = null;
            
            if (checkedCount % 50 === 0) {
            }
            
            if (transfer.destinations && transfer.destinations.length > 0) {
                for (const dest of transfer.destinations) {
                    if (dest.SCID) {
                        scid = dest.SCID;
                        if (dest.amount >= 1) {
                            try {
                                const nftData = await this.parseNFTFromTransfer(transfer, scid);
                                if (nftData && !seenNFTs.has(nftData.id)) {
                                    seenNFTs.add(nftData.id);
                                    nfts.push(nftData);
                                } else if (!nftData) {
                                    collectionSCIDs.add(scid);
                                }
                            } catch (error) {
                            }
                        }
                    }
                }
            }
            
            if (transfer.payload_rpc && transfer.payload_rpc.length > 0) {
                let foundSCID = null;
                let tokenId = null;
                let tokenUri = null;
                
                for (const rpc of transfer.payload_rpc) {
                    if (rpc.name === 'scid' && rpc.value) {
                        foundSCID = rpc.value;
                    }
                    if (rpc.name === 'token_id' || rpc.name === 'tokenId') {
                        tokenId = rpc.value;
                    }
                    if (rpc.name === 'token_uri' || rpc.name === 'tokenUri' || rpc.name === 'uri') {
                        tokenUri = rpc.value;
                    }
                }
                
                const targetSCID = foundSCID || scid;
                
                const hasMintOrTransfer = transfer.payload_rpc.some(rpc => 
                    rpc.name === 'entrypoint' && (rpc.value === 'Mint' || rpc.value === 'Transfer')
                );
                
                if (targetSCID && hasMintOrTransfer) {
                    try {
                        const nftData = await this.parseNFTFromPayload(transfer, null, targetSCID, tokenId, tokenUri);
                        if (nftData && !seenNFTs.has(nftData.id)) {
                            seenNFTs.add(nftData.id);
                            nfts.push(nftData);
                        }
                    } catch (error) {
                    }
                }
            }
            
            if (transfer.sc_rpc && Array.isArray(transfer.sc_rpc)) {
                let foundSCID = null;
                let tokenId = null;
                let tokenUri = null;
                
                for (const rpc of transfer.sc_rpc) {
                    if (rpc.name === 'scid' && rpc.value) {
                        foundSCID = rpc.value;
                    }
                    if (rpc.name === 'token_id' || rpc.name === 'tokenId') {
                        tokenId = rpc.value;
                    }
                    if (rpc.name === 'token_uri' || rpc.name === 'tokenUri' || rpc.name === 'uri') {
                        tokenUri = rpc.value;
                    }
                }
                
                const hasMintOrTransfer = transfer.sc_rpc.some(rpc => 
                    rpc.name === 'entrypoint' && (rpc.value === 'Mint' || rpc.value === 'Transfer')
                );
                
                
                const targetSCID = foundSCID || scid;
                
                if (targetSCID && hasMintOrTransfer) {
                    try {
                        const nftData = await this.parseNFTFromPayload(transfer, null, targetSCID, tokenId, tokenUri);
                        if (nftData && !seenNFTs.has(nftData.id)) {
                            seenNFTs.add(nftData.id);
                            nfts.push(nftData);
                        }
                    } catch (error) {
                    }
                }
            }
        }
        
        if (collectionSCIDs.size > 0) {
            for (const scid of collectionSCIDs) {
                try {
                    const ownedNFTs = await this.queryOwnedNFTsFromSCID(scid);
                    for (const nft of ownedNFTs) {
                        if (!seenNFTs.has(nft.id)) {
                            seenNFTs.add(nft.id);
                            if (this.enrichAssetWithG45) {
                                nfts.push(await this.enrichAssetWithG45(nft));
                            } else {
                                nfts.push(nft);
                            }
                        }
                    }
                } catch (error) {
                }
            }
        }
        
        return nfts;
    };

    DeroNFTApp.prototype.parseNFTFromTransfer = async function(transfer, scid) {
        let tokenId = null;
        let tokenUri = null;
        
        if (transfer.payload_rpc) {
            for (const rpc of transfer.payload_rpc) {
                if (rpc.name === 'token_id' || rpc.name === 'tokenId') {
                    tokenId = rpc.value;
                }
                if (rpc.name === 'token_uri' || rpc.name === 'tokenUri' || rpc.name === 'uri') {
                    tokenUri = rpc.value;
                }
            }
        }
        
        if (scid && tokenId) {
            try {
                if (this.deroWallet && this.deroWallet.ws && this.deroWallet.ws.getSC) {
                    const uriResult = await this.deroWallet.ws.getSC(scid, 'TokenURI', [{
                        name: 'token_id',
                        datatype: 'U',
                        value: tokenId
                    }]);
                    
                    if (!uriResult || uriResult.error) {
                    } else if (uriResult.result) {
                        tokenUri = this.deroWallet.ws.extractValue(uriResult);
                    }
                }
            } catch (e) {
            }
        }
        
        if (scid && !tokenId) {
            if (this.queryG45AT) {
                const g45Asset = await this.queryG45AT(scid);
                if (g45Asset) {
                    const currentAddressLower = (this.currentAddress || '').toLowerCase();
                    const directOwner = (transfer.destination || transfer.sender || '').toLowerCase();
                    if (currentAddressLower && directOwner && currentAddressLower === directOwner) {
                        g45Asset.owned = true;
                    }
                    return g45Asset;
                }
            }
            return null;
        }

        const possibleOwners = new Set();
        if (transfer.destination) {
            possibleOwners.add(transfer.destination);
        }
        if (transfer.sender) {
            possibleOwners.add(transfer.sender);
        }
        if (Array.isArray(transfer.destinations)) {
            transfer.destinations.forEach(dest => {
                if (dest.address) {
                    possibleOwners.add(dest.address);
                }
                if (dest.destination) {
                    possibleOwners.add(dest.destination);
                }
            });
        }

        const currentAddressLower = (this.currentAddress || '').toLowerCase();
        const ownerMatch = Array.from(possibleOwners).find(addr => addr && addr.toLowerCase() === currentAddressLower);

        const nft = {
            id: `${scid}_${tokenId || 'unknown'}`,
            scid: scid,
            tokenId: tokenId,
            txid: transfer.txid || transfer.tx_hash || transfer.height,
            name: tokenId ? `NFT #${tokenId}` : `NFT ${scid.substring(0, 8)}...`,
            type: 'NFT',
            image: tokenUri || (this.getPlaceholderImage ? this.getPlaceholderImage() : ''),
            description: tokenId ? `Token ID: ${tokenId}` : 'NFT from smart contract',
            collection_name: 'My NFT Collection',
            owner: ownerMatch || transfer.destination || transfer.sender || null,
            owned: Boolean(ownerMatch)
        };

        if (this.enrichAssetWithG45) {
            return await this.enrichAssetWithG45(nft);
        }
        
        return nft;
    };

    DeroNFTApp.prototype.parseNFTFromPayload = async function(transfer, rpc, scid, tokenId, tokenUri) {
        try {
            let extractedTokenId = tokenId;
            let extractedTokenUri = tokenUri;
            let extractedSCID = scid;
            let toAddress = null;
            
            if (transfer.payload_rpc) {
                for (const param of transfer.payload_rpc) {
                    if (param.name === 'token_id' || param.name === 'tokenId') {
                        extractedTokenId = param.value;
                    }
                    if (param.name === 'token_uri' || param.name === 'tokenUri' || param.name === 'uri') {
                        extractedTokenUri = param.value;
                    }
                    if (param.name === 'to') {
                        toAddress = param.value;
                    }
                    if (param.name === 'scid') {
                        extractedSCID = param.value;
                    }
                }
            }
            
            if (!extractedSCID && transfer.destinations && transfer.destinations[0]) {
                extractedSCID = transfer.destinations[0].SCID || transfer.SCID;
            }
            
            if (extractedSCID) {
                const possibleOwners = new Set();
                if (transfer.destination) {
                    possibleOwners.add(transfer.destination);
                }
                if (transfer.sender) {
                    possibleOwners.add(transfer.sender);
                }
                if (Array.isArray(transfer.destinations)) {
                    transfer.destinations.forEach(dest => {
                        if (dest.address) {
                            possibleOwners.add(dest.address);
                        }
                        if (dest.destination) {
                            possibleOwners.add(dest.destination);
                        }
                    });
                }

                const currentAddressLower = (this.currentAddress || '').toLowerCase();
                const ownerMatch = Array.from(possibleOwners).find(addr => addr && addr.toLowerCase() === currentAddressLower);

                if (!extractedTokenId && this.queryG45AT) {
                    const g45Asset = await this.queryG45AT(extractedSCID);
                    if (g45Asset) {
                        if (ownerMatch) {
                            g45Asset.owned = true;
                        }
                        return g45Asset;
                    }
                }

                const nft = {
                    id: `${extractedSCID}_${extractedTokenId || 'unknown'}`,
                    scid: extractedSCID,
                    tokenId: extractedTokenId,
                    txid: transfer.txid || transfer.tx_hash || transfer.height,
                    name: extractedTokenId ? `NFT #${extractedTokenId}` : `NFT ${extractedSCID.substring(0, 8)}...`,
                    type: 'NFT',
                    image: extractedTokenUri || (this.getPlaceholderImage ? this.getPlaceholderImage() : ''),
                    description: extractedTokenId ? `Token ID: ${extractedTokenId}` : 'NFT from smart contract',
                    collection_name: 'My NFT Collection',
                    owner: ownerMatch || transfer.destination || transfer.sender || null,
                    owned: Boolean(ownerMatch)
                };

                if (this.enrichAssetWithG45) {
                    return await this.enrichAssetWithG45(nft);
                }

                return nft;
            }
            
            return null;
        } catch (error) {
            return null;
        }
    };

    DeroNFTApp.prototype.queryNFTFromSCID = async function(scid, txid) {
        try {
            if (!this.deroWallet || !this.deroWallet.ws) {
                return null;
            }
            
            const base = {
                id: scid.substring(0, 64),
                scid: scid,
                txid: txid,
                name: `NFT ${scid.substring(0, 8)}`,
                type: 'NFT',
                image: this.getPlaceholderImage ? this.getPlaceholderImage() : '',
                description: 'NFT from smart contract',
                collection_name: 'Unknown Collection'
            };

            if (this.enrichAssetWithG45) {
                return await this.enrichAssetWithG45(base);
            }
            return base;
        } catch (error) {
            return null;
        }
    };

    DeroNFTApp.prototype.queryToken = async function(scid, tokenId) {
        try {
            let owner = null;
            if (this.deroWallet && this.deroWallet.ws && this.deroWallet.ws.getSC) {
                const ownerResult = await this.deroWallet.ws.getSC(scid, 'OwnerOf', [{
                    name: 'token_id',
                    datatype: 'U',
                    value: tokenId
                }]);
                
                if (ownerResult?.error) {
                    return null;
                }
                
                
                if (ownerResult && ownerResult.result) {
                    owner = this.deroWallet.ws.extractValue(ownerResult);
                    if (ownerResult.result.txid && !owner) {
                        return null;
                    }
                } else if (ownerResult) {
                    owner = this.deroWallet.ws.extractValue(ownerResult);
                }
                
                if (!owner || owner === '' || owner === '0') {
                    return null;
                }
                
            }

            let tokenUri = null;
            if (this.deroWallet && this.deroWallet.ws && this.deroWallet.ws.getSC) {
                try {
                    const uriResult = await this.deroWallet.ws.getSC(scid, 'TokenURI', [{
                        name: 'token_id',
                        datatype: 'U',
                        value: tokenId
                    }]);
                    
                    if (!uriResult || uriResult.error) {
                        console.warn(`TokenURI skipped for token ${tokenId}: ${uriResult?.error || 'no result'}`);
                    } else if (uriResult.result) {
                        tokenUri = this.deroWallet.ws.extractValue(uriResult);
                    }
                } catch (e) {
                }
            }

            if (owner) {
                return {
                    id: `${scid}_${tokenId}`,
                    scid: scid,
                    tokenId: tokenId,
                    name: `NFT #${tokenId}`,
                    type: 'NFT',
                    image: tokenUri || (this.getPlaceholderImage ? this.getPlaceholderImage() : ''),
                    description: `Token ID: ${tokenId} from collection ${scid.substring(0, 8)}...`,
                    collection_name: 'Unknown Collection',
                    owner: owner,
                    uri: tokenUri
                };
            }
            
            return null;
        } catch (e) {
            return null;
        }
    };

    DeroNFTApp.prototype.queryOwnedNFTsFromSCID = async function(scid) {
        const nfts = [];
        try {
            if (!this.deroWallet || !this.deroWallet.ws || !this.currentAddress) {
                return [];
            }

            const foundTokens = new Set();

            // Use DERO.GetSC to get TotalSupply and check each token with OwnerOf + GetBalance
            // This is the correct approach - NO GetTransfers needed
            if (this.deroWallet.ws.getSC) {
                
                // Get TotalSupply from collection contract
                let totalSupply = 0;
                try {
                    const scState = await this.deroWallet.ws.getSC(scid, false, true);
                    const scData = scState?.result || scState;
                    const uint64Keys = scData?.uint64keys || {};
                    const stringKeys = scData?.stringkeys || {};
                    
                    // Try different key names for TotalSupply
                    if (uint64Keys['TotalSupply'] !== undefined) {
                        totalSupply = parseInt(uint64Keys['TotalSupply'], 10) || 0;
                    } else if (uint64Keys['totalSupply'] !== undefined) {
                        totalSupply = parseInt(uint64Keys['totalSupply'], 10) || 0;
                    } else if (uint64Keys['total_supply'] !== undefined) {
                        totalSupply = parseInt(uint64Keys['total_supply'], 10) || 0;
                    } else {
                        // Try calling TotalSupply function
                        try {
                            const totalSupplyResult = await this.deroWallet.ws.getSC(scid, 'TotalSupply', []);
                            if (totalSupplyResult && !totalSupplyResult.error && totalSupplyResult.result) {
                                const supply = this.deroWallet.ws.extractValue ? this.deroWallet.ws.extractValue(totalSupplyResult) : null;
                                if (supply) {
                                    totalSupply = parseInt(supply, 10) || 0;
                                }
                            }
                        } catch (e) {
                            console.warn('Could not get TotalSupply via function call:', e);
                        }
                    }
                } catch (e) {
                    console.warn('Could not get TotalSupply from contract state:', e);
                }

                // If TotalSupply not found, try checking for single-SCID collection (each NFT has its own SCID)
                if (totalSupply === 0) {
                    // Check if this is a single-SCID collection - get all asset SCIDs from contract
                    try {
                        if (this.fetchCollectionAssetScidsFromContract) {
                            const assetScids = await this.fetchCollectionAssetScidsFromContract(scid);
                            if (assetScids && assetScids.length > 0) {
                                // For each asset SCID, check balance
                                for (const assetScid of assetScids) {
                                    try {
                                        const balance = await this.deroWallet.getBalance(null, assetScid);
                                        if (balance > 0) {
                                            // Query asset details
                                            const assetData = await this.queryAssetBySCID ? await this.queryAssetBySCID(assetScid) : null;
                                            if (assetData) {
                                                assetData.owned = true;
                                                assetData.collection_scid = scid;
                                                const nftId = `${assetScid}`;
                                                if (!foundTokens.has(nftId)) {
                                                    foundTokens.add(nftId);
                                                    if (this.enrichAssetWithG45) {
                                                        nfts.push(await this.enrichAssetWithG45(assetData));
                                                    } else {
                                                        nfts.push(assetData);
                                                    }
                                                }
                                            }
                                        }
                                    } catch (assetError) {
                                        console.warn(`Error checking asset ${assetScid}:`, assetError);
                                    }
                                }
                                return nfts; // Return early since we handled single-SCID collection
                            }
                        }
                    } catch (scidError) {
                        console.warn('Could not fetch collection asset SCIDs:', scidError);
                    }
                }

                const maxTokens = totalSupply > 0 ? Math.min(totalSupply, 500) : 100; // Increased limit, check up to 500 tokens
                for (let tokenId = 1; tokenId <= maxTokens; tokenId++) {
                    try {
                        const ownerResult = await this.deroWallet.ws.getSC(scid, 'OwnerOf', [{
                            name: 'token_id',
                            datatype: 'U',
                            value: tokenId
                        }]);

                        if (!ownerResult || ownerResult.error) {
                            continue;
                        }

                        if (ownerResult && ownerResult.result) {
                            const hasOnlyTxid = ownerResult.result.txid && 
                                              !ownerResult.result.stringvalues && 
                                              !ownerResult.result.values &&
                                              !ownerResult.result.stringvalue;
                            
                            if (hasOnlyTxid) {
                                continue;
                            }

                            const owner = this.deroWallet.ws.extractValue(ownerResult);

                            if (owner && owner.toLowerCase() === this.currentAddress.toLowerCase()) {
                                let tokenUri = null;
                                try {
                                    const uriResult = await this.deroWallet.ws.getSC(scid, 'TokenURI', [{
                                        name: 'token_id',
                                        datatype: 'U',
                                        value: tokenId
                                    }]);
                                    
                                    if (!uriResult || uriResult.error) {
                                    } else if (uriResult.result) {
                                        tokenUri = this.deroWallet.ws.extractValue(uriResult);
                                    }
                                } catch (e) {
                                }

                                const currentAddrLower = (this.currentAddress || '').toLowerCase();
                                const ownerLower = owner ? owner.toLowerCase() : '';
                                const nft = {
                                    id: `${scid}_${tokenId}`,
                                    scid: scid,
                                    tokenId: tokenId,
                                    name: `NFT #${tokenId}`,
                                    type: 'NFT',
                                    image: tokenUri || (this.getPlaceholderImage ? this.getPlaceholderImage() : ''),
                                    description: `Token ID: ${tokenId} from collection ${scid.substring(0, 8)}...`,
                                    collection_name: 'NFT Collection',
                                    owner: owner,
                                    owned: Boolean(currentAddrLower && ownerLower && ownerLower === currentAddrLower)
                                };

                                if (!foundTokens.has(nft.id)) {
                                    foundTokens.add(nft.id);
                                    if (this.enrichAssetWithG45) {
                                        nfts.push(await this.enrichAssetWithG45(nft));
                                    } else {
                                        nfts.push(nft);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                    }
                }
                
            }
        } catch (error) {
        }
        return nfts;
    };

    // Utility functions moved to combined.js

    DeroNFTApp.prototype.performSearch = async function() {
        // Simple, safe search function - no crashes
        const queryInput = document.getElementById('searchQuery');
        if (!queryInput) {
            return;
        }

        const query = (queryInput.value || '').trim();
        if (!query) {
            // Simple console log instead of notification to avoid crashes
            return;
        }

        // Check wallet connection (but don't require it for validation)
        const normalizedQuery = query.trim().toLowerCase();
        const isSCID = normalizedQuery.length === 64 && /^[0-9a-f]+$/.test(normalizedQuery);
        
        if (!isSCID) {
            // Invalid SCID - simple notification, no crash
            // Try to show notification, but don't crash if it fails
            try {
                if (this.showNotification && typeof this.showNotification === 'function') {
                    this.showNotification('Invalid SCID format. Expected 64 hex characters.', 'info');
                }
            } catch (e) {
            }
            // Clear any loading state
            try {
                if (this.hideLoading) {
                    this.hideLoading('loadingSearch');
                }
            } catch (e) {
                // Ignore
            }
            // Clear results
            try {
                const container = document.getElementById('searchResults');
                if (container) {
                    container.innerHTML = '';
                }
            } catch (e) {
                // Ignore
            }
            return;
        }

        // Check wallet connection for actual search
        if (!this.deroWallet || !this.deroWallet.ws || !this.deroWallet.ws.getSC) {
            try {
                if (this.showNotification && typeof this.showNotification === 'function') {
                    this.showNotification('Please connect your wallet to search.', 'warning');
                }
            } catch (e) {
            }
            return;
        }

        this.showLoading('loadingSearch');

        try {
            // On-chain search only - queryAssetBySCID uses DERO.GetSC (no permissions needed)
            let asset;
            try {
                asset = await this.queryAssetBySCID(normalizedQuery, { forceRefresh: true });
            } catch (queryError) {
                // Show error notification safely
                try {
                    const errorMsg = queryError?.message || 'Search failed';
                    this.showNotification(`Search failed: ${errorMsg}`, 'error');
                } catch (notifError) {
                }
                
                // Clear results safely
                this.lastSearchResults = [];
                try {
                    this.renderSearchResults([]);
                } catch (renderError) {
                }
                return;
            }
            
            if (!asset) {
                try {
                    this.showNotification('No asset found for that SCID.', 'warning');
                    this.lastSearchResults = [];
                    this.renderSearchResults([]);
                } catch (renderError) {
                }
                return;
            }
            
            // Handle error objects from queryAssetBySCID
            if (asset.error) {
                try {
                    const errorMsg = asset.errorMessage || 'Failed to query asset';
                    this.showNotification(`Search failed: ${errorMsg}`, 'error');
                    this.lastSearchResults = [];
                    this.renderSearchResults([]);
                } catch (renderError) {
                }
                return;
            }

            let results = [asset];
            
            // Check if it's a collection (by isCollection flag, contractType, or type)
            const isCollection = asset.isCollection || 
                                asset.contractType === 'G45-C' || 
                                asset.type === 'Collection' ||
                                (asset.contractType && asset.contractType.includes('Collection'));
            
            // If it's a collection, try to load child NFTs/NFAs (on-chain only)
            if (isCollection) {
                // Update asset to mark it as collection
                asset.isCollection = true;
                
                try {
                    // First try queryAllCollectionNFTs (handles both token-based and single-SCID collections)
                    let childAssets = [];
                    if (this.queryAllCollectionNFTs) {
                        childAssets = await this.queryAllCollectionNFTs(normalizedQuery);
                    }
                    // If that didn't work, try loadCollectionFromChain
                    if ((!childAssets || childAssets.length === 0) && this.loadCollectionFromChain) {
                        childAssets = await this.loadCollectionFromChain(normalizedQuery);
                    }
                    // If we got child assets, add them to results
                    if (Array.isArray(childAssets) && childAssets.length > 0) {
                        // Ensure all child assets have collection_scid set
                        childAssets = childAssets.map(child => ({
                            ...child,
                            collection_scid: normalizedQuery,
                            collection_name: asset.collection_name || asset.name
                        }));
                        results = [asset, ...childAssets];
                    } else {
                        results = [asset];
                    }
                } catch (error) {
                    // On error, still show the collection itself - don't crash
                    console.warn('Error loading collection NFTs:', error);
                    results = [asset];
                }
            }

            this.lastSearchResults = results;
            try {
                this.renderSearchResults(results);
            } catch (renderError) {
                // Ignore render errors
            }
        } catch (error) {
            // Show error notification but don't crash
            try {
                this.showNotification(`Search failed: ${error.message || 'Unknown error'}`, 'error');
            } catch (notifError) {
                console.error('Failed to show error notification:', notifError);
            }
            this.lastSearchResults = [];
            try {
                this.renderSearchResults([]);
            } catch (renderError) {
                console.error('Failed to render empty search results:', renderError);
            }
        } finally {
            try {
                this.hideLoading('loadingSearch');
            } catch (hideError) {
            }
        }
    };

    // Search for NFA collection by name (for collections without master contract like GROKNFA-MS1)
    // This searches both cached data and on-chain via GetTransfers + DERO.GetSC
    DeroNFTApp.prototype.searchNFACollectionByName = async function(collectionName) {
        const normalized = collectionName.toLowerCase().trim();
        if (!normalized) {
            return [];
        }

        const results = [];
        const seenScids = new Set();

        // Step 1: Search cached/saved assets first (fast)
        const candidates = [];
        
        // From saved assets
        if (Array.isArray(this.savedAssets)) {
            candidates.push(...this.savedAssets);
        }
        
        // From cache
        const cached = this.assetsCache?.value;
        if (Array.isArray(cached)) {
            candidates.push(...cached);
        } else if (cached?.nfts && Array.isArray(cached.nfts)) {
            candidates.push(...cached.nfts);
        }
        
        // From last search results
        if (Array.isArray(this.lastSearchResults)) {
            candidates.push(...this.lastSearchResults);
        }

        // Search through cached candidates for matching collection name
        for (const asset of candidates) {
            if (!asset || !asset.scid) continue;
            
            // Skip if already seen
            const scidLower = asset.scid.toLowerCase();
            if (seenScids.has(scidLower)) continue;
            seenScids.add(scidLower);

            // Check if it's an NFA and matches collection name
            const assetType = asset.type || asset.assetType || '';
            const isNFA = assetType.toLowerCase().includes('nfa') || 
                         assetType.toLowerCase().includes('artificer') ||
                         (asset.contractType && asset.contractType.toLowerCase().includes('nfa'));
            
            if (!isNFA) continue;

            // Check collection name match
            const assetCollectionName = (asset.collection_name || asset.name || '').toLowerCase();
            const assetName = (asset.name || '').toLowerCase();
            const assetSymbol = (asset.symbol || '').toLowerCase();
            
            // Match if collection name is in asset name, collection_name, or symbol
            if (assetCollectionName.includes(normalized) || 
                assetName.includes(normalized) || 
                assetSymbol.includes(normalized)) {
                results.push(asset);
            }
        }

        // Step 2: Search on-chain via GetTransfers (if wallet connected and we have parseAssetsFromTransfers)
        // This finds NFAs from recent transfers that match the collection name
        if (this.deroWallet && this.deroWallet.ws && this.parseAssetsFromTransfers && this.ensureTransferAssetCache) {
            try {
                
                // Ensure we have transfer cache
                await this.ensureTransferAssetCache();
                
                // Parse assets from transfers
                const transfers = this.transfersCache?.value || [];
                if (Array.isArray(transfers) && transfers.length > 0) {
                    const transferAssets = await this.parseAssetsFromTransfers(transfers);
                    
                    // Check each asset from transfers
                    for (const asset of transferAssets) {
                        if (!asset || !asset.scid) continue;
                        
                        const scidLower = asset.scid.toLowerCase();
                        if (seenScids.has(scidLower)) continue;
                        seenScids.add(scidLower);

                        // Check if it's an NFA
                        const assetType = asset.type || asset.assetType || '';
                        const isNFA = assetType.toLowerCase().includes('nfa') || 
                                     assetType.toLowerCase().includes('artificer') ||
                                     (asset.contractType && asset.contractType.toLowerCase().includes('nfa'));
                        
                        if (!isNFA) continue;

                        // Query on-chain to get full asset data and check collection name
                        try {
                            const queryFn = this.queryAssetBySCID || this.queryG45AT;
                            if (queryFn) {
                                const onChainAsset = await queryFn(asset.scid, { forceRefresh: true });
                                if (onChainAsset && !onChainAsset.error) {
                                    const onChainName = (onChainAsset.name || '').toLowerCase();
                                    const onChainCollection = (onChainAsset.collection_name || '').toLowerCase();
                                    const onChainSymbol = (onChainAsset.symbol || '').toLowerCase();
                                    
                                    // Check if on-chain data matches collection name
                                    if (onChainName.includes(normalized) || 
                                        onChainCollection.includes(normalized) || 
                                        onChainSymbol.includes(normalized)) {
                                        results.push(onChainAsset);
                                    }
                                }
                            }
                        } catch (error) {
                            // If on-chain query fails, check cached data from transfer
                            const assetName = (asset.name || '').toLowerCase();
                            const assetCollection = (asset.collection_name || '').toLowerCase();
                            const assetSymbol = (asset.symbol || '').toLowerCase();
                            
                            if (assetName.includes(normalized) || 
                                assetCollection.includes(normalized) || 
                                assetSymbol.includes(normalized)) {
                                results.push(asset);
                            }
                        }
                    }
                }
            } catch (error) {
                // Continue with cached results only
            }
        }

        if (results.length === 0) {
        } else {
        }

        return results;
    };

    DeroNFTApp.prototype.searchInUserTransfers = async function(query) {
        const normalized = query.toLowerCase();

        const collectCandidateAssets = async () => {
            const candidates = [];
            const cached = this.assetsCache?.value;
            if (Array.isArray(cached)) {
                candidates.push(...cached);
            } else if (cached?.nfts && Array.isArray(cached.nfts)) {
                candidates.push(...cached.nfts);
            }
            if (candidates.length === 0 && Array.isArray(this.savedAssets)) {
                candidates.push(...this.savedAssets);
            }
            if (candidates.length === 0 && this.transfersCache?.value) {
                const parsed = await this.parseAssetsFromTransfers(this.transfersCache.value);
                candidates.push(...parsed);
            }
            return candidates;
        };

        const candidates = await collectCandidateAssets();
        if (!candidates || candidates.length === 0) {
            return [];
        }

        const matches = [];
        for (const rawAsset of candidates) {
            if (!rawAsset) continue;
            const asset = { ...rawAsset };
            const searchFields = [
                asset.name,
                asset.id,
                asset.scid,
                asset.collection_name,
                asset.collection_scid,
                asset.tokenId && `#${asset.tokenId}`,
                asset.symbol
            ]
                .filter(Boolean)
                .map((value) => value.toString().toLowerCase());

            const hasMatch = searchFields.some((value) => value.includes(normalized));
            if (!hasMatch) {
                continue;
            }

            const enriched = this.enrichAssetWithG45 ? await this.enrichAssetWithG45(asset) : asset;
            matches.push(enriched);
        }

        return matches;
    };

    DeroNFTApp.prototype.searchToken = async function(scidInput) {
        const rawValue = (scidInput || '').trim();
        const normalized = rawValue.toLowerCase();
        
        if (!rawValue) {
            this.showError?.('Please enter a token SCID to search.');
            return;
        }
        if (!/^[0-9a-f]{64}$/.test(normalized)) {
            this.showError?.('Invalid token SCID. It must be 64 hexadecimal characters.');
            return;
        }
        if (!this.deroWallet || !this.deroWallet.ws || !this.deroWallet.ws.getSC) {
            this.showError?.('Connect a wallet to query token details.');
            return;
        }
        
        this.showLoading?.('loadingTokenTrading');
        
        try {
            const tokenDetails = await this.fetchTokenDetails(normalized);
            if (!tokenDetails) {
                throw new Error('Token metadata not found for that SCID.');
            }
            
            let balanceAtomic = 0;
            if (typeof this.deroWallet.getBalance === 'function') {
                try {
                    const rawBalance = await this.deroWallet.getBalance(null, normalized);
                    balanceAtomic = Number(rawBalance) || 0;
                } catch (balanceError) {
                    // Continue even if balance fetch fails
                }
            }
            
            tokenDetails.balanceAtomic = balanceAtomic;
            tokenDetails.balanceFormatted = this.formatTokenAmount ? this.formatTokenAmount(balanceAtomic, tokenDetails.decimals) : '0';
            this.currentTokenInfo = tokenDetails;
            
            // Make sure the results container is visible
            const container = document.getElementById('tokenSearchResults');
            if (container) {
                container.classList.remove('hidden');
            }
            
            this.renderTokenSearchResults([tokenDetails]);
        } catch (error) {
            // Show error message in the results area
            const container = document.getElementById('tokenSearchResults');
            const list = document.getElementById('tokenResultsList');
            if (container && list) {
                container.classList.remove('hidden');
                list.innerHTML = `<div class="token-results-empty" style="color: #ff6b6b;">Error: ${error?.message || 'Failed to load token data.'}</div>`;
            }
            this.showError?.(error?.message || 'Failed to load token data.');
        } finally {
            this.hideLoading?.('loadingTokenTrading');
        }
    };

    DeroNFTApp.prototype.fetchTokenDetails = async function(scid) {
        try {
            const scResult = await this.deroWallet.ws.getSC(scid);
            if (!scResult) {
                throw new Error('No response from DERO node.');
            }
            if (scResult.error) {
                throw new Error(scResult.error.message || 'Unable to fetch contract state.');
            }
            // Handle different response structures: scResult.result, scResult directly, or nested
            let scData = scResult;
            if (scResult.result) {
                scData = scResult.result;
            } else if (scResult.stringkeys || scResult.uint64keys) {
                scData = scResult; // Already the data object
            }
            const parsed = this.extractTokenMetadataFromSC(scData, scid);
            if (!parsed) {
                throw new Error('Token metadata missing or unreadable.');
            }
            return parsed;
        } catch (error) {
            throw error instanceof Error ? error : new Error('Failed to fetch token state.');
        }
    };

    DeroNFTApp.prototype.extractTokenMetadataFromSC = function(scData, scid) {
        if (!scData) {
            // Return minimal token info even if no contract data
            return {
                scid,
                name: `Token ${scid.substring(0, 8)}...`,
                ticker: '',
                decimals: 0,
                totalSupply: 0,
                supplyFormatted: null,
                icon: '',
                description: '',
                metadata: null
            };
        }
        const stringKeys = scData.stringkeys || {};
        const uint64Keys = scData.uint64keys || {};
        
        // Log all available keys for debugging
        
        const decodeHex = (value) => {
            if (typeof value !== 'string') return value;
            // Try to decode hex string manually if decodeHexString is not available
            try {
                // Check if it's a hex string (starts with hex characters)
                if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
                    // Try to decode as hex
                    let decoded = '';
                    for (let i = 0; i < value.length; i += 2) {
                        const hexByte = value.substring(i, i + 2);
                        const charCode = parseInt(hexByte, 16);
                        if (charCode >= 32 && charCode <= 126) { // Printable ASCII
                            decoded += String.fromCharCode(charCode);
                        } else if (charCode === 0) {
                            break; // Stop at null terminator
                        }
                    }
                    if (decoded.trim().length > 0) {
                        return decoded.trim();
                    }
                }
            } catch (e) {
            }
            // Use decodeHexString if available (it handles hex decoding properly)
            if (this.decodeHexString) {
                const decoded = this.decodeHexString(value);
                return this.sanitizePrintableString ? this.sanitizePrintableString(decoded) : decoded;
            }
            return value;
        };
        const decodeString = (keys) => {
            for (const key of keys) {
                if (!(key in stringKeys)) {
                    continue;
                }
                const rawValue = stringKeys[key];
                const decoded = decodeHex(rawValue);
                if (decoded && decoded !== rawValue) {
                    return decoded;
                } else if (decoded) {
                    return decoded;
                }
            }
            return '';
        };
        const decodeNumber = (keys) => {
            for (const key of keys) {
                if (uint64Keys[key] !== undefined) {
                    const parsed = parseInt(uint64Keys[key], 10);
                    if (!Number.isNaN(parsed)) {
                        return parsed;
                    }
                }
                if (stringKeys[key] !== undefined) {
                    const decoded = decodeHex(stringKeys[key]);
                    const parsed = parseInt(decoded, 10);
                    if (!Number.isNaN(parsed)) {
                        return parsed;
                    }
                    const hexParsed = parseInt(decoded, 16);
                    if (!Number.isNaN(hexParsed)) {
                        return hexParsed;
                    }
                }
            }
            return 0;
        };
        
        const metadataRaw = decodeString(['metadata', 'token_metadata', 'meta']);
        let metadata = null;
        if (metadataRaw && metadataRaw.trim().startsWith('{')) {
            try {
                metadata = JSON.parse(metadataRaw);
            } catch (error) {
            }
        }
        
        // Try multiple key name variations (different token standards use different keys)
        const name =
            decodeString(['name', 'nameHdr', 'token_name', 'tokenname', 'collection', 'collectionName']) ||
            (metadata && metadata.name) ||
            `Token ${scid.substring(0, 8)}...`;
        const ticker =
            (decodeString(['symbol', 'ticker', 'tickerHdr', 'token_symbol', 'tokenSymbol', 'symbolHdr']) || metadata?.symbol || '').toUpperCase();
        const decimals = decodeNumber(['decimals', 'token_decimals', 'precision', 'dec']);
        const totalSupply = decodeNumber(['totalSupply', 'totalsupply', 'maxSupply', 'supply', 'total_supply', 'hard_cap']);
        // Try multiple image/icon key variations
        const image = 
            decodeString(['image', 'icon', 'iconURLHdr', 'iconUrl', 'logo', 'imageUrl', 'image_url', 'icon_url']) ||
            (metadata && (metadata.image || metadata.icon || metadata.logo)) ||
            '';
        const description = metadata?.description || decodeString(['description', 'desc']);
        
        const supplyFormatted = totalSupply ? this.formatTokenAmount(totalSupply, decimals) : null;
        
        // Always return token info, even if minimal
        return {
            scid,
            name,
            ticker,
            decimals: Number.isFinite(decimals) ? decimals : 0,
            totalSupply,
            supplyFormatted,
            icon: image,
            description,
            metadata
        };
    };

    DeroNFTApp.prototype.formatTokenAmount = function(balanceAtomic, decimals = 0, options = {}) {
        const numericBalance = Number(balanceAtomic) || 0;
        // DERO tokens use the same atomic unit system as DERO: 1 token = 100,000 atomic units
        // The decimals parameter is ignored - all DERO tokens use 100,000 atomic units per whole unit
        const value = numericBalance / 100000;
        const maxFractionDigits = typeof options.maxFractionDigits === 'number'
            ? options.maxFractionDigits
            : 5; // Default to 5 decimal places (same as DERO)
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: Math.max(0, maxFractionDigits)
        });
    };

    DeroNFTApp.prototype.renderTokenSearchResults = function(tokens = []) {
        const app = this; // Capture app instance for use in closures
        const container = document.getElementById('tokenSearchResults');
        const list = document.getElementById('tokenResultsList');
        if (!container || !list) {
            return;
        }
        
        list.innerHTML = '';
        if (!tokens.length) {
            container.classList.remove('hidden');
            const empty = document.createElement('div');
            empty.className = 'token-results-empty';
            empty.textContent = 'Enter a token SCID to see its details.';
            list.appendChild(empty);
            return;
        }
        
        container.classList.remove('hidden');
        tokens.forEach((token) => {
            const row = document.createElement('div');
            row.className = 'token-row';
            row.dataset.scid = token.scid;
            row.style.cursor = 'pointer';
            row.onclick = (e) => {
                // Don't trigger if clicking dropdown
                if (!e.target.closest('.token-dropdown-container')) {
                    app.showTokenDetailsPopup(token);
                }
            };
            
            const icon = document.createElement('img');
            icon.className = 'token-icon';
            icon.alt = `${token.name || 'Token'} icon`;
            // Use icon, image, or placeholder - check multiple possible fields
            const iconUrl = token.icon || token.image || (token.metadata && (token.metadata.icon || token.metadata.image || token.metadata.logo)) || '';
            if (iconUrl) {
                icon.src = iconUrl;
                icon.onerror = () => {
                    icon.onerror = null;
                    // Don't set placeholder if icon fails - just hide it
                    icon.style.display = 'none';
                };
            } else {
                // No icon available - create a placeholder div instead
                icon.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'token-icon-placeholder';
                placeholder.textContent = (token.ticker || token.name || '?').substring(0, 2).toUpperCase();
                placeholder.style.cssText = 'width: 40px; height: 40px; border-radius: 50%; background: #4a9eff; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;';
                row.insertBefore(placeholder, row.firstChild);
            }
            
            const meta = document.createElement('div');
            meta.className = 'token-meta';
            
            const nameLine = document.createElement('div');
            nameLine.className = 'token-name';
            const nameSpan = document.createElement('span');
            // Get name from token object or metadata
            const tokenName = token.name || (token.metadata && token.metadata.name) || `Token ${token.scid.substring(0, 8)}...`;
            nameSpan.textContent = tokenName;
            nameLine.appendChild(nameSpan);
            // Get ticker from token object or metadata
            const tokenTicker = token.ticker || (token.metadata && token.metadata.symbol) || '';
            if (tokenTicker) {
                const tickerSpan = document.createElement('span');
                tickerSpan.className = 'token-ticker';
                tickerSpan.textContent = tokenTicker.toUpperCase();
                nameLine.appendChild(tickerSpan);
            }
            
            const scidLine = document.createElement('div');
            scidLine.className = 'token-scid';
            scidLine.textContent = token.scid;
            
            meta.appendChild(nameLine);
            meta.appendChild(scidLine);
            
            const detailParts = [];
            if (token.supplyFormatted) {
                detailParts.push(`Supply: ${token.supplyFormatted}`);
            }
            if (Number.isFinite(token.decimals)) {
                detailParts.push(`Decimals: ${token.decimals}`);
            }
            if (detailParts.length) {
                const detailLine = document.createElement('div');
                detailLine.className = 'token-meta-details';
                detailLine.textContent = detailParts.join(' • ');
                meta.appendChild(detailLine);
            }
            
            const balanceBlock = document.createElement('div');
            balanceBlock.className = 'token-balance';
            const balanceLabel = document.createElement('div');
            balanceLabel.className = 'token-balance-label';
            balanceLabel.textContent = 'Balance';
            const balanceValue = document.createElement('div');
            balanceValue.className = 'token-balance-value';
            balanceValue.textContent = token.balanceFormatted || '0';
            balanceBlock.appendChild(balanceLabel);
            balanceBlock.appendChild(balanceValue);
            if (token.balanceAtomic !== undefined) {
                const atomicLine = document.createElement('div');
                atomicLine.className = 'token-balance-atomic';
                atomicLine.textContent = `${token.balanceAtomic} atomic`;
                balanceBlock.appendChild(atomicLine);
            }
            
            // Add dropdown menu
            const dropdownContainer = document.createElement('div');
            dropdownContainer.className = 'token-dropdown-container';
            dropdownContainer.style.cssText = 'position: relative; margin-left: auto;';
            
            const dropdownBtn = document.createElement('button');
            dropdownBtn.className = 'token-dropdown-btn';
            dropdownBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
            dropdownBtn.style.cssText = 'background: transparent; border: none; color: #fff; cursor: pointer; padding: 8px; font-size: 16px;';
            dropdownBtn.onclick = (e) => {
                e.stopPropagation();
                const menu = dropdownContainer.querySelector('.token-dropdown-menu');
                if (menu) {
                    // Close all other dropdowns
                    document.querySelectorAll('.token-dropdown-menu').forEach(m => {
                        if (m !== menu) m.classList.remove('show');
                    });
                    menu.classList.toggle('show');
                }
            };
            
            const dropdownMenu = document.createElement('div');
            dropdownMenu.className = 'token-dropdown-menu';
            
            const menuItems = [
                { text: 'Save Token', icon: 'fa-save', action: () => app.saveToken(token) },
                { text: 'Remove Token', icon: 'fa-trash', action: () => app.removeToken(token) },
                { text: 'Transfer Token', icon: 'fa-paper-plane', action: () => app.transferToken(token) },
                { text: 'Create Sell Order', icon: 'fa-arrow-down', action: () => {
                    if (app && app.showNotification) {
                        app.showNotification('Trading features coming soon.', 'info');
                    } else {
                        alert('Trading features coming soon.');
                    }
                }},
                { text: 'Create Buy Order', icon: 'fa-arrow-up', action: () => {
                    if (app && app.showNotification) {
                        app.showNotification('Trading features coming soon.', 'info');
                    } else {
                        alert('Trading features coming soon.');
                    }
                }},
                { text: 'View Orders & Graph', icon: 'fa-chart-line', action: () => app.showTokenDetailsPopup(token) },
                { text: 'Refresh Balance', icon: 'fa-sync-alt', action: () => app.refreshTokenBalance(token) }
            ];
            
            menuItems.forEach(item => {
                const menuItem = document.createElement('div');
                menuItem.className = 'token-dropdown-item';
                menuItem.innerHTML = `<i class="fas ${item.icon}"></i> <span>${item.text}</span>`;
                menuItem.onclick = (e) => {
                    e.stopPropagation();
                    dropdownMenu.classList.remove('show');
                    item.action();
                };
                dropdownMenu.appendChild(menuItem);
            });
            
            dropdownContainer.appendChild(dropdownBtn);
            dropdownContainer.appendChild(dropdownMenu);
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!dropdownContainer.contains(e.target)) {
                    dropdownMenu.classList.remove('show');
                }
            });
            
            row.appendChild(icon);
            row.appendChild(meta);
            row.appendChild(balanceBlock);
            row.appendChild(dropdownContainer);
            list.appendChild(row);
        });
    };

    // Token management functions
    DeroNFTApp.prototype.saveToken = function(token) {
        if (!token || !token.scid) {
            this.showError?.('Invalid token data');
            return;
        }
        
        if (!Array.isArray(this.savedTokens)) {
            this.savedTokens = [];
        }
        
        // Check if token already saved
        const existingIndex = this.savedTokens.findIndex(t => t.scid === token.scid);
        if (existingIndex >= 0) {
            this.showNotification?.('Token already saved', 'info');
            return;
        }
        
        // Save token (only metadata, not in view assets)
        const tokenToSave = {
            scid: token.scid,
            name: token.name || `Token ${token.scid.substring(0, 8)}...`,
            ticker: token.ticker || '',
            icon: token.icon || '',
            decimals: token.decimals || 0,
            totalSupply: token.totalSupply || 0,
            supplyFormatted: token.supplyFormatted || null,
            description: token.description || '',
            metadata: token.metadata || null,
            savedAt: Date.now()
        };
        
        this.savedTokens.push(tokenToSave);
        this.saveTokens();
        this.showSuccess?.('Token saved to cache');
        // Refresh the display to show the saved token
        this.loadSavedTokensForDisplay();
    };

    DeroNFTApp.prototype.removeToken = function(token) {
        if (!token || !token.scid) {
            this.showError?.('Invalid token data');
            return;
        }
        
        // Ensure savedTokens is loaded from localStorage first
        if (!Array.isArray(this.savedTokens) || this.savedTokens.length === 0) {
            this.savedTokens = this.loadSavedTokens ? this.loadSavedTokens() : [];
        }
        
        // Normalize SCID for comparison (case-insensitive, trim whitespace)
        const targetScid = (token.scid || '').toLowerCase().trim();
        if (!targetScid) {
            this.showError?.('Invalid token SCID');
            return;
        }
        
        // Find and remove token (case-insensitive comparison)
        const beforeCount = this.savedTokens.length;
        this.savedTokens = this.savedTokens.filter(t => {
            const savedScid = (t.scid || '').toLowerCase().trim();
            return savedScid !== targetScid;
        });
        
        if (this.savedTokens.length === beforeCount) {
            this.showNotification?.('Token not found in saved tokens', 'info');
            return;
        }
        
        // Save to localStorage
        this.saveTokens();
        
        // Reload from localStorage to ensure consistency
        if (this.loadSavedTokens) {
            this.savedTokens = this.loadSavedTokens();
        }
        
        this.showSuccess?.('Token removed from cache');
        // Refresh the display to remove the token
        this.loadSavedTokensForDisplay();
    };

    // Token transfer and management functions moved to appfeat7.js

    // Load and display saved tokens in the token trading tab
    DeroNFTApp.prototype.loadSavedTokensForDisplay = async function() {
        if (!this.currentAddress) {
            // Show empty state if not connected
            const container = document.getElementById('tokenSearchResults');
            const list = document.getElementById('tokenResultsList');
            if (container && list) {
                container.classList.remove('hidden');
                list.innerHTML = '<div class="token-results-empty">Connect your wallet to view saved tokens.</div>';
            }
            return;
        }
        
        // Use instance variable if available, otherwise load from localStorage
        const savedTokens = (Array.isArray(this.savedTokens) && this.savedTokens.length > 0) 
            ? this.savedTokens 
            : (this.loadSavedTokens ? this.loadSavedTokens() : []);
        if (!savedTokens || savedTokens.length === 0) {
            // No saved tokens - show empty state
            const container = document.getElementById('tokenSearchResults');
            const list = document.getElementById('tokenResultsList');
            if (container && list) {
                container.classList.remove('hidden');
                list.innerHTML = '<div class="token-results-empty">No saved tokens. Search for a token and click "Save Token" to add it here.</div>';
            }
            return;
        }
        
        // Show loading state
        const container = document.getElementById('tokenSearchResults');
        const list = document.getElementById('tokenResultsList');
        if (container && list) {
            container.classList.remove('hidden');
            list.innerHTML = '<div class="token-results-empty">Loading saved tokens...</div>';
        }
        
        // Fetch balance and metadata for each saved token
        const tokensWithBalance = [];
        for (const savedToken of savedTokens) {
            try {
                // Fetch current balance
                let balanceAtomic = 0;
                if (this.deroWallet && this.deroWallet.getBalance) {
                    try {
                        balanceAtomic = await this.deroWallet.getBalance(null, savedToken.scid);
                        balanceAtomic = Number(balanceAtomic) || 0;
                    } catch (error) {
                    }
                }
                
                // Use saved metadata or fetch fresh
                const tokenData = {
                    scid: savedToken.scid,
                    name: savedToken.name,
                    ticker: savedToken.ticker,
                    icon: savedToken.icon,
                    decimals: savedToken.decimals || 0,
                    totalSupply: savedToken.totalSupply || 0,
                    supplyFormatted: savedToken.supplyFormatted,
                    description: savedToken.description || '',
                    metadata: savedToken.metadata,
                    balanceAtomic: balanceAtomic,
                    balanceFormatted: this.formatTokenAmount ? this.formatTokenAmount(balanceAtomic, savedToken.decimals || 0) : '0'
                };
                
                tokensWithBalance.push(tokenData);
            } catch (error) {
                // Still add the token even if balance fetch failed
                tokensWithBalance.push({
                    ...savedToken,
                    balanceAtomic: 0,
                    balanceFormatted: '0'
                });
            }
        }
        
        // Render the saved tokens
        if (tokensWithBalance.length > 0) {
            this.renderTokenSearchResults(tokensWithBalance);
        } else {
            // No tokens loaded - show empty state
            if (container && list) {
                list.innerHTML = '<div class="token-results-empty">No saved tokens found.</div>';
            }
        }
    };

    // Token balance refresh and details popup functions moved to appfeat7.js

    // Collection scanning logic (moved from appfeat1.js)
    // Collection scanning and viewing functions moved to appfeat4.js
}

// Initialize the application when DOM is ready (after both part files are loaded)
function initializeApp() {
    if (typeof DeroNFTApp !== 'undefined') {
        window.app = new DeroNFTApp();
        
        // Now call init() to set up event listeners and initialize
        window.app.init();
        
    }
}

// Initialize when ready
try {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
        // DOM already loaded, initialize immediately
        initializeApp();
    }
} catch (error) {
    // Fallback: try again after a short delay
    setTimeout(initializeApp, 100);
}
