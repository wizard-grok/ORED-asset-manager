        // Update Engram status when wallet connects/disconnects
        function updateEngramStatus(connected) {
            const statusEl = document.getElementById('engramStatus');
            if (!statusEl) return;
            
            if (connected) {
                statusEl.className = 'engram-status connected';
                statusEl.style.background = '#2a5a2a';
                statusEl.style.border = '1px solid #4a9a4a';
                statusEl.textContent = '✅ Connected to wallet - Ready for calls';
            } else {
                statusEl.className = 'engram-status disconnected';
                statusEl.style.background = '#5a2a2a';
                statusEl.style.border = '1px solid #9a4a4a';
                statusEl.textContent = '⚠️ Connect wallet to use wallet calls';
            }
        }

        function logEngramResponse(data) {
            const pre = document.getElementById('engramResponse');
            if (pre) {
                pre.textContent = JSON.stringify(data, null, 2);
            }
            console.log('Engram Response:', data);
        }

        // Check if wallet is connected before making calls
        function checkWalletConnection(requireWebSocket = true) {
            if (!window.app) {
                alert('ORED app not initialized. Please refresh the page.');
                return false;
            }
            // Check if wallet is connected - currentAddress is set when wallet connects
            // Also check isConnected flag and WebSocket status
            const hasAddress = window.app.currentAddress && window.app.currentAddress.length > 0;
            const isConnected = window.app.isConnected === true;
            const hasWebSocket = window.app.deroWallet && window.app.deroWallet.ws;
            
            if (!hasAddress && !isConnected) {
                alert('Please connect your wallet first.');
                return false;
            }
            
            // For functions that need WebSocket (most do)
            if (requireWebSocket && !hasWebSocket) {
                alert('Wallet WebSocket connection unavailable. Please reconnect your wallet.');
                return false;
            }
            
            return true;
        }

        // Test Get Balance
        async function testGetBalance() {
            if (!checkWalletConnection()) return;
            
            try {
                const address = document.getElementById('balanceAddress').value.trim() || null;
                const scid = document.getElementById('balanceScid').value.trim() || null;
                
                logEngramResponse({ method: 'GetBalance', params: { address, scid }, status: 'sending...' });
                
                const result = await window.app.deroWallet.getBalance(address, scid);
                logEngramResponse({ 
                    method: 'GetBalance', 
                    params: { address, scid }, 
                    result: result,
                    formatted: {
                        balance: result,
                        dero: (result / 100000).toFixed(5) + ' DERO'
                    }
                });
            } catch (error) {
                logEngramResponse({ 
                    method: 'GetBalance', 
                    params: { address, scid }, 
                    error: error.message || error,
                    stack: error.stack 
                });
            }
        }

        // Test Get SC
        async function testGetSC() {
            if (!checkWalletConnection()) return;
            
            try {
                const scid = document.getElementById('scidGetSC').value.trim();
                if (!scid || scid.length !== 64) {
                    alert('Invalid SCID. Must be 64 hex characters.');
                    return;
                }

                logEngramResponse({ method: 'DERO.GetSC', params: { scid }, status: 'sending...' });
                
                const result = await window.app.deroWallet.ws.getSC(scid, false, true);
                // Handle both wrapped (result.result) and direct result structures
                const scData = result?.result || result;
                const stringKeys = scData?.stringkeys || {};
                const uint64Keys = scData?.uint64keys || {};
                logEngramResponse({ 
                    method: 'DERO.GetSC', 
                    params: { scid }, 
                    result: result,
                    summary: {
                        hasResult: !!scData,
                        hasStringKeys: Object.keys(stringKeys).length > 0,
                        hasUint64Keys: Object.keys(uint64Keys).length > 0,
                        stringKeyCount: Object.keys(stringKeys).length,
                        uint64KeyCount: Object.keys(uint64Keys).length,
                        stringKeyNames: Object.keys(stringKeys).slice(0, 20), // Show first 20 keys
                        uint64KeyNames: Object.keys(uint64Keys).slice(0, 20)
                    }
                });
            } catch (error) {
                logEngramResponse({ 
                    method: 'DERO.GetSC', 
                    params: { scid }, 
                    error: error.message || error,
                    stack: error.stack 
                });
            }
        }

        // Test Gnomon.GetOwner
        async function testGnomonGetOwner() {
            if (!checkWalletConnection()) return;
            
            try {
                const scid = document.getElementById('scidGnomon').value.trim();
                if (!scid || scid.length !== 64) {
                    alert('Invalid SCID. Must be 64 hex characters.');
                    return;
                }

                logEngramResponse({ method: 'Gnomon.GetOwner', params: { scid }, status: 'sending...' });
                
                // Try using getSCOwner method if available
                if (window.app.deroWallet.getSCOwner) {
                    const result = await window.app.deroWallet.getSCOwner(scid);
                    logEngramResponse({ 
                        method: 'Gnomon.GetOwner', 
                        params: { scid }, 
                        result: result,
                        summary: {
                            owner: result,
                            matchesWallet: window.app.currentAddress && result && result.toLowerCase() === window.app.currentAddress.toLowerCase(),
                            note: result ? 'Owner found via Gnomon indexer' : 'No owner found in Gnomon index'
                        }
                    });
                } else {
                    // Fallback: call directly via sendRequest
                    const result = await window.app.deroWallet.ws.sendRequest('Gnomon.GetOwner', { scid });
                    // Gnomon returns {getOwner: "address"} format
                    const owner = result?.getOwner || result?.owner || result?.result?.getOwner || result?.result?.owner || null;
                    logEngramResponse({ 
                        method: 'Gnomon.GetOwner', 
                        params: { scid }, 
                        rawResult: result,
                        extractedOwner: owner,
                        summary: {
                            owner: owner,
                            matchesWallet: window.app.currentAddress && owner && owner.toLowerCase() === window.app.currentAddress.toLowerCase(),
                            note: owner ? 'Owner found via Gnomon indexer' : 'No owner found in Gnomon index (may require Gnomon node setup)'
                        }
                    });
                }
            } catch (error) {
                logEngramResponse({ 
                    method: 'Gnomon.GetOwner', 
                    params: { scid }, 
                    error: error.message || error,
                    note: 'Gnomon.GetOwner may require a Gnomon node to be running. This is a decentralized search engine for DERO.',
                    stack: error.stack 
                });
            }
        }

        // Test Debug Missing NFT
        async function testDebugMissingNFT() {
            if (!checkWalletConnection()) return;
            
            try {
                const scid = document.getElementById('debugNftScid').value.trim();
                const txid = document.getElementById('debugNftTxid').value.trim() || null;
                
                if (!scid || scid.length !== 64) {
                    alert('Invalid NFT SCID. Must be 64 hex characters.');
                    return;
                }

                logEngramResponse({ method: 'Debug Missing NFT', params: { scid, txid }, status: 'debugging...' });
                
                const results = {
                    scid: scid,
                    txid: txid,
                    checks: {}
                };
                
                // 1. Check wallet balance
                try {
                    const balance = await window.app.deroWallet.getBalance(null, scid);
                    results.checks.walletBalance = {
                        atomic: balance,
                        dero: (balance / 100000).toFixed(5),
                        found: balance > 0
                    };
                } catch (error) {
                    results.checks.walletBalance = { error: error.message };
                }
                
                // 2. Get full contract state
                try {
                    const scResult = await window.app.deroWallet.ws.getSC(scid);
                    const scData = scResult?.result || scResult;
                    const stringKeys = scData?.stringkeys || {};
                    const uint64Keys = scData?.uint64keys || {};
                    
                    // Helper to extract base address from integrated address
                    // DERO integrated addresses: prefix (5 chars) + base (66 chars) + paymentId (8 chars) = 79 chars total
                    const extractBaseAddress = (addr) => {
                        if (!addr) return '';
                        const lower = addr.toLowerCase();
                        // Remove dero1/deto1 prefix (5 chars)
                        const withoutPrefix = lower.replace(/^(dero1|deto1)/, '');
                        // Base address is first 66 characters (before payment ID)
                        if (withoutPrefix.length >= 66) {
                            return withoutPrefix.substring(0, 66);
                        }
                        return withoutPrefix;
                    };
                    
                    // Helper to normalize address for comparison (remove prefix, get base)
                    const normalizeAddress = (addr) => {
                        if (!addr) return '';
                        return extractBaseAddress(addr);
                    };
                    
                    // Find ALL owner_ keys (both string and uint64)
                    const ownerKeys = [];
                    const currentWalletAddress = window.app.currentAddress || '';
                    const currentWalletBase = normalizeAddress(currentWalletAddress);
                    
                    // Check string keys
                    for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                        const keyLower = rawKey.toLowerCase();
                        if (keyLower.startsWith('owner_')) {
                            let amount = 0;
                            // Check uint64Keys first
                            if (uint64Keys[rawKey] !== undefined) {
                                amount = parseInt(uint64Keys[rawKey], 10) || 0;
                            } else if (rawValue) {
                                amount = parseInt(rawValue, 10) || parseInt(rawValue, 16) || 0;
                            }
                            
                            // Extract address from key (remove "owner_" prefix)
                            const addressInKey = rawKey.substring(6); // Remove "owner_" (6 chars)
                            const decodedKey = window.app.decodeHexString ? window.app.decodeHexString(rawKey) : rawKey;
                            const addressFromDecoded = decodedKey.startsWith('owner_') ? decodedKey.substring(6) : decodedKey;
                            
                            // Normalize addresses for comparison
                            const keyBaseAddress = normalizeAddress(addressInKey);
                            const decodedBaseAddress = normalizeAddress(addressFromDecoded);
                            const matchesCurrentWallet = currentWalletBase && (
                                keyBaseAddress === currentWalletBase || 
                                decodedBaseAddress === currentWalletBase ||
                                addressInKey.toLowerCase() === currentWalletAddress.toLowerCase() ||
                                addressFromDecoded.toLowerCase() === currentWalletAddress.toLowerCase()
                            );
                            
                            ownerKeys.push({
                                key: rawKey,
                                decodedKey: decodedKey,
                                addressInKey: addressInKey,
                                addressFromDecoded: addressFromDecoded,
                                keyBaseAddress: keyBaseAddress,
                                decodedBaseAddress: decodedBaseAddress,
                                rawValue: rawValue,
                                amount: amount,
                                amountDERO: (amount / 100000).toFixed(5),
                                source: 'stringKeys',
                                matchesCurrentWallet: matchesCurrentWallet
                            });
                        }
                    }
                    
                    // Check uint64 keys
                    for (const [rawKey, rawValue] of Object.entries(uint64Keys)) {
                        const keyLower = rawKey.toLowerCase();
                        if (keyLower.startsWith('owner_')) {
                            // Check if already in ownerKeys
                            if (!ownerKeys.find(k => k.key === rawKey)) {
                                // Extract address from key
                                const addressInKey = rawKey.substring(6);
                                const decodedKey = window.app.decodeHexString ? window.app.decodeHexString(rawKey) : rawKey;
                                const addressFromDecoded = decodedKey.startsWith('owner_') ? decodedKey.substring(6) : decodedKey;
                                
                                // Normalize addresses for comparison
                                const keyBaseAddress = normalizeAddress(addressInKey);
                                const decodedBaseAddress = normalizeAddress(addressFromDecoded);
                                const matchesCurrentWallet = currentWalletBase && (
                                    keyBaseAddress === currentWalletBase || 
                                    decodedBaseAddress === currentWalletBase ||
                                    addressInKey.toLowerCase() === currentWalletAddress.toLowerCase() ||
                                    addressFromDecoded.toLowerCase() === currentWalletAddress.toLowerCase()
                                );
                                
                                ownerKeys.push({
                                    key: rawKey,
                                    decodedKey: decodedKey,
                                    addressInKey: addressInKey,
                                    addressFromDecoded: addressFromDecoded,
                                    keyBaseAddress: keyBaseAddress,
                                    decodedBaseAddress: decodedBaseAddress,
                                    rawValue: rawValue,
                                    amount: parseInt(rawValue, 10) || 0,
                                    amountDERO: (parseInt(rawValue, 10) / 100000).toFixed(5),
                                    source: 'uint64Keys',
                                    matchesCurrentWallet: matchesCurrentWallet
                                });
                            }
                        }
                    }
                    
                    results.checks.contractState = {
                        totalStringKeys: Object.keys(stringKeys).length,
                        totalUint64Keys: Object.keys(uint64Keys).length,
                        ownerKeys: ownerKeys,
                        allOwnerKeyNames: [
                            ...Object.keys(stringKeys).filter(k => k.toLowerCase().startsWith('owner_')),
                            ...Object.keys(uint64Keys).filter(k => k.toLowerCase().startsWith('owner_'))
                        ],
                        contractBalance: scData?.balance || 0,
                        contractBalances: scData?.balances || {},
                        allStringKeys: Object.keys(stringKeys),
                        allUint64Keys: Object.keys(uint64Keys)
                    };
                } catch (error) {
                    results.checks.contractState = { error: error.message };
                }
                
                // 3. Check transaction details if txid provided
                if (txid && txid.length === 64) {
                    try {
                        const transfers = await window.app.deroWallet.ws.sendRequest('GetTransfers', {
                            in: true,
                            out: true,
                            sc: true,
                            min_height: 0,
                            max_height: 0
                        });
                        
                        const txList = transfers?.result?.transfers || transfers?.result?.entries || [];
                        const foundTx = txList.find(tx => tx.txid === txid);
                        
                        if (foundTx) {
                            results.checks.transaction = {
                                found: true,
                                txid: foundTx.txid,
                                height: foundTx.height,
                                destinations: foundTx.destinations || [],
                                sc_rpc: foundTx.sc_rpc || [],
                                payload_rpc: foundTx.payload_rpc || [],
                                amount: foundTx.amount || 0,
                                scid: foundTx.scid || null,
                                time: foundTx.time || null
                            };
                        } else {
                            results.checks.transaction = { found: false, note: 'Transaction not found in wallet history' };
                        }
                    } catch (error) {
                        results.checks.transaction = { error: error.message };
                    }
                }
                
                // 4. Check current wallet address
                const currentWalletAddress = window.app.currentAddress || 'Not connected';
                results.checks.walletAddress = currentWalletAddress;
                
                // 5. Find matching owner keys (by base address)
                const helperNormalize = (addr) => {
                    if (!addr) return '';
                    const lower = addr.toLowerCase();
                    const withoutPrefix = lower.replace(/^(dero1|deto1)/, '');
                    return withoutPrefix.length >= 66 ? withoutPrefix.substring(0, 66) : withoutPrefix;
                };
                
                const currentWalletBase = helperNormalize(currentWalletAddress);
                const matchingOwnerKeys = results.checks.contractState?.ownerKeys?.filter(ok => {
                    if (!currentWalletBase) return false;
                    return ok.matchesCurrentWallet || 
                           ok.keyBaseAddress === currentWalletBase ||
                           ok.decodedBaseAddress === currentWalletBase ||
                           ok.addressInKey.toLowerCase() === currentWalletAddress.toLowerCase() ||
                           ok.addressFromDecoded.toLowerCase() === currentWalletAddress.toLowerCase();
                }) || [];
                
                // Also check if any owner key has a balance > 0 (displayed NFT)
                const displayedOwnerKeys = results.checks.contractState?.ownerKeys?.filter(ok => ok.amount >= 100000) || [];
                
                logEngramResponse({
                    method: 'Debug Missing NFT',
                    params: { scid, txid },
                    results: results,
                    summary: {
                        walletBalance: results.checks.walletBalance?.found 
                            ? `${results.checks.walletBalance.dero} DERO (${results.checks.walletBalance.atomic} atomic)` 
                            : '0 (not in wallet)',
                        ownerKeysFound: results.checks.contractState?.ownerKeys?.length || 0,
                        displayedOwnerKeys: displayedOwnerKeys.length,
                        matchingOwnerKeys: matchingOwnerKeys.length,
                        contractBalance: results.checks.contractState?.contractBalance || 0,
                        transactionFound: results.checks.transaction?.found || false,
                        currentWalletBase: currentWalletBase || 'N/A',
                        note: matchingOwnerKeys.length > 0
                            ? `✅ Found ${matchingOwnerKeys.length} owner_ key(s) matching your wallet address. ${displayedOwnerKeys.length > 0 ? `Found ${displayedOwnerKeys.length} displayed NFT(s) (amount >= 100,000).` : 'No displayed NFTs found (amount < 100,000).'}`
                            : displayedOwnerKeys.length > 0
                            ? `Found ${displayedOwnerKeys.length} displayed NFT(s) in contract, but none match your current wallet address (${currentWalletAddress.substring(0, 20)}...). The displayed wallet may be different.`
                            : results.checks.contractState?.ownerKeys?.length > 0
                            ? `Found ${results.checks.contractState.ownerKeys.length} owner_ key(s) in contract, but none match your wallet address. Check the addressInKey and addressFromDecoded fields to see which wallet displayed the NFT.`
                            : 'No owner_ keys found in contract. The NFT may not be displayed, or the address format might not match. Check transaction details if txid was provided.'
                    }
                });
            } catch (error) {
                logEngramResponse({ 
                    method: 'Debug Missing NFT', 
                    error: error.message || error,
                    stack: error.stack 
                });
            }
        }

        // Test Query Displayed NFT - Shows ALL displayed balances for any SCID
        async function testQueryDisplayedNFT() {
            // This function doesn't require wallet connection - it scans all owner keys
            // No wallet connection required - this is a public contract query
            try {
                const scid = document.getElementById('displayedNftScid').value.trim();
                
                if (!scid || scid.length !== 64) {
                    alert('Invalid NFT SCID. Must be 64 hex characters.');
                    return;
                }

                if (!/^[0-9a-f]{64}$/i.test(scid)) {
                    alert('Invalid SCID format. Must be 64 hexadecimal characters.');
                    return;
                }

                logEngramResponse({ method: 'Query Displayed NFTs (G45)', params: { scid }, status: 'querying contract state...' });
                
                // Get contract state - use DERO.GetSC which doesn't require wallet connection
                let scResult;
                if (window.app && window.app.deroWallet && window.app.deroWallet.ws) {
                    scResult = await window.app.deroWallet.ws.getSC(scid);
                } else {
                    // Try direct RPC call if wallet not connected
                    alert('Wallet connection required for DERO.GetSC. Please connect wallet first.');
                    return;
                }
                
                const scData = scResult?.result || scResult;
                const stringKeys = scData?.stringkeys || {};
                const uint64Keys = scData?.uint64keys || {};
                
                // Find ALL owner_<address> keys (not filtered by address)
                const displayedBalances = [];
                const seenKeys = new Set();
                
                // Helper to normalize address (handle dero1/deto1 prefixes)
                const normalizeAddress = (addr) => {
                    if (!addr) return '';
                    const lower = addr.toLowerCase();
                    // Remove dero1/deto1 prefix and get the base address
                    const base = lower.replace(/^(dero1|deto1)/, '');
                    return base;
                };
                
                // Helper to convert address format (dero1 <-> deto1)
                const convertAddressFormat = (addr) => {
                    if (!addr) return addr;
                    if (addr.toLowerCase().startsWith('dero1')) {
                        return 'deto1' + addr.substring(5);
                    } else if (addr.toLowerCase().startsWith('deto1')) {
                        return 'dero1' + addr.substring(5);
                    }
                    return addr;
                };
                
                // Check uint64Keys first (more reliable for amounts)
                for (const [rawKey, amountValue] of Object.entries(uint64Keys)) {
                    const keyLower = rawKey.toLowerCase();
                    if (keyLower.startsWith('owner_')) {
                        seenKeys.add(rawKey);
                        const ownerAddr = rawKey.substring(6); // Remove "owner_" prefix
                        const amount = parseInt(amountValue, 10) || 0;
                        
                        if (amount > 0) {
                            displayedBalances.push({
                                key: rawKey,
                                address: ownerAddr,
                                addressNormalized: normalizeAddress(ownerAddr),
                                addressAlternate: convertAddressFormat(ownerAddr),
                                amount: amount,
                                amountDERO: (amount / 100000).toFixed(5) + ' DERO',
                                nftCount: Math.floor(amount / 100000), // Number of NFTs (100k atomic units each)
                                isNFT: amount >= 100000,
                                note: amount < 100000 ? `⚠️ Amount ${amount} is less than 100,000 (1 NFT). This might be a partial display or contract issue.` : ''
                            });
                        }
                    }
                }
                
                // Check stringKeys for owner_ keys that might not be in uint64Keys
                for (const [rawKey, rawValue] of Object.entries(stringKeys)) {
                    const keyLower = rawKey.toLowerCase();
                    if (keyLower.startsWith('owner_') && !seenKeys.has(rawKey)) {
                        seenKeys.add(rawKey);
                        const ownerAddr = rawKey.substring(6); // Remove "owner_" prefix
                        
                        let amount = 0;
                        // Try to get amount from uint64Keys first (more reliable)
                        if (uint64Keys[rawKey] !== undefined) {
                            amount = parseInt(uint64Keys[rawKey], 10) || 0;
                        } else if (rawValue) {
                            // If rawValue is the address itself, assume 1 NFT (100k atomic units)
                            // Some contracts store owner_address as string with address as value
                            let decodedValue = rawValue;
                            try {
                                if (window.app && window.app.decodeHexString) {
                                    decodedValue = window.app.decodeHexString(rawValue);
                                }
                            } catch (e) {
                                // If decode fails, use raw value
                                decodedValue = rawValue;
                            }
                            
                            // Ensure decodedValue is a string before calling string methods
                            const decodedStr = String(decodedValue || '');
                            
                            if (decodedStr && (decodedStr.toLowerCase().includes('dero1') || decodedStr.toLowerCase().includes('deto1'))) {
                                // Value is an address - assume 1 NFT
                                amount = 100000;
                            } else {
                                // Try parsing as decimal or hex
                                amount = parseInt(decodedStr, 10) || parseInt(decodedStr, 16) || 0;
                            }
                        }
                        
                        // Only include if amount > 0 (has displayed balance)
                        if (amount > 0) {
                            displayedBalances.push({
                                key: rawKey,
                                address: ownerAddr,
                                addressNormalized: normalizeAddress(ownerAddr),
                                addressAlternate: convertAddressFormat(ownerAddr),
                                amount: amount,
                                amountDERO: (amount / 100000).toFixed(5) + ' DERO',
                                nftCount: Math.floor(amount / 100000),
                                isNFT: amount >= 100000,
                                note: amount < 100000 ? `⚠️ Amount ${amount} is less than 100,000 (1 NFT). This might be a partial display or contract issue.` : ''
                            });
                        }
                    }
                }
                
                // Sort by amount (descending)
                displayedBalances.sort((a, b) => b.amount - a.amount);
                
                // Get all owner_ keys for debugging
                const allOwnerKeys = [
                    ...Object.keys(stringKeys).filter(k => k.toLowerCase().startsWith('owner_')),
                    ...Object.keys(uint64Keys).filter(k => k.toLowerCase().startsWith('owner_'))
                ];
                
                logEngramResponse({
                    method: 'Query Displayed NFTs (G45)',
                    params: { scid },
                    contractState: {
                        hasStringKeys: Object.keys(stringKeys).length > 0,
                        hasUint64Keys: Object.keys(uint64Keys).length > 0,
                        totalStringKeys: Object.keys(stringKeys).length,
                        totalUint64Keys: Object.keys(uint64Keys).length,
                        ownerKeysFound: displayedBalances.length,
                        allOwnerKeys: allOwnerKeys,
                        rawStringKeys: Object.keys(stringKeys).filter(k => k.toLowerCase().startsWith('owner_')).reduce((acc, k) => {
                            acc[k] = stringKeys[k];
                            return acc;
                        }, {}),
                        rawUint64Keys: Object.keys(uint64Keys).filter(k => k.toLowerCase().startsWith('owner_')).reduce((acc, k) => {
                            acc[k] = uint64Keys[k];
                            return acc;
                        }, {})
                    },
                    displayedBalances: displayedBalances,
                    summary: {
                        totalDisplayed: displayedBalances.length,
                        totalNFTs: displayedBalances.reduce((sum, b) => sum + b.nftCount, 0),
                        totalAmount: displayedBalances.reduce((sum, b) => sum + b.amount, 0),
                        totalAmountDERO: (displayedBalances.reduce((sum, b) => sum + b.amount, 0) / 100000).toFixed(5) + ' DERO',
                        note: displayedBalances.length > 0 
                            ? `Found ${displayedBalances.length} address(es) with displayed balances. Total: ${displayedBalances.reduce((sum, b) => sum + b.nftCount, 0)} NFT(s) displayed. ${displayedBalances.some(b => b.amount < 100000) ? '⚠️ Some amounts are less than 100,000 (1 NFT = 100,000 atomic units). This might indicate a contract storage issue or partial display.' : ''}`
                            : 'No displayed balances found. The NFT contract may not have any displayed NFTs, or they may be stored in a different format.',
                        addressFormatNote: 'Addresses are shown as stored in contract. Check addressAlternate field for dero1/deto1 conversion. If addresses don\'t match your wallet, the contract might be storing addresses in a different format.',
                        amountNote: 'Expected amount for 1 NFT: 100,000 atomic units. If amount is different, check contract storage format.'
                    }
                });
            } catch (error) {
                logEngramResponse({ 
                    method: 'Query Displayed NFTs (G45)', 
                    error: error.message || error,
                    stack: error.stack 
                });
            }
        }

        // Test Query NFA Status - MOVED TO appfeat6.js
        // Function moved to appfeat6.js

        // Test Custom Call
        async function testCustomCall() {
            if (!checkWalletConnection()) return;
            
            try {
                const method = document.getElementById('customMethod').value.trim();
                const paramsText = document.getElementById('customParams').value.trim();
                
                if (!method) {
                    alert('Method is required');
                    return;
                }

                let params = {};
                if (paramsText) {
                    params = JSON.parse(paramsText);
                }

                logEngramResponse({ method, params, status: 'sending...' });
                
                // Use the wallet's sendRequest method
                const result = await window.app.deroWallet.ws.sendRequest(method, params);
                logEngramResponse({ 
                    method, 
                    params, 
                    result: result 
                });
            } catch (error) {
                logEngramResponse({ 
                    method: 'Custom', 
                    error: error.message || error,
                    stack: error.stack 
                });
            }
        }

        // Monitor wallet connection status
        function checkAndUpdateStatus() {
            if (!window.app) {
                updateEngramStatus(false);
                return;
            }
            
            // Check multiple indicators of wallet connection
            const hasAddress = window.app.currentAddress && window.app.currentAddress.length > 0;
            const isConnected = window.app.isConnected === true;
            const hasWebSocket = window.app.deroWallet && window.app.deroWallet.ws;
            const wsConnected = hasWebSocket && (window.app.deroWallet.ws.isConnected || window.app.deroWallet.ws.isAuthenticated);
            
            // Consider connected if we have address OR WebSocket is connected
            const connected = (hasAddress || isConnected) && (hasWebSocket || wsConnected);
            
            updateEngramStatus(connected);
        }

        // Update status when app is ready
        window.addEventListener('load', () => {
            setTimeout(checkAndUpdateStatus, 1000);
            // Check periodically
            setInterval(checkAndUpdateStatus, 2000);
        });

        // Expose all test functions globally so they can be called from HTML onclick handlers
        // Functions moved to appfeat6.js, appfeat7.js, and appfeat8.js are exposed there
        window.testGetBalance = testGetBalance;
        window.testGetSC = testGetSC;
        window.testGnomonGetOwner = testGnomonGetOwner;
        window.testDebugMissingNFT = testDebugMissingNFT;
        window.testQueryDisplayedNFT = testQueryDisplayedNFT;
        window.testCustomCall = testCustomCall;
        // testQueryNFAStatus moved to appfeat6.js
        // testQueryMarketplaceOrders is in index.js
        // testGetTransactionHistory moved to appfeat7.js

        // Also check when wallet connects/disconnects
        if (window.app) {
            const originalConnect = window.app.connectWallet;
            if (originalConnect) {
                window.app.connectWallet = async function(...args) {
                    const result = await originalConnect.apply(this, args);
                    setTimeout(checkAndUpdateStatus, 500);
                    return result;
                };
            }
            const originalDisconnect = window.app.disconnectWallet;
            if (originalDisconnect) {
                window.app.disconnectWallet = function(...args) {
                    const result = originalDisconnect.apply(this, args);
                    setTimeout(checkAndUpdateStatus, 100);
                    return result;
                };
            }
        }
        
        // Also expose functions after a delay in case app loads after this script
        setTimeout(() => {
            if (window.app) {
                const originalConnect = window.app.connectWallet;
                if (originalConnect && !window.app.connectWallet.toString().includes('checkAndUpdateStatus')) {
                    window.app.connectWallet = async function(...args) {
                        const result = await originalConnect.apply(this, args);
                        setTimeout(checkAndUpdateStatus, 500);
                        return result;
                    };
                }
            }
            checkAndUpdateStatus();
        }, 2000);

// Wallet Calls Test Functions - Marketplace Orders and Advanced GetSC
// testQueryNFAStatus moved to appfeat6.js

// Advanced GetSC method with alternative format handling
if (typeof WebSocketManager !== 'undefined') {
    WebSocketManager.prototype.getSCAdvanced = async function(scid, entrypoint, sc_rpc = []) {
        try {
            if (entrypoint) {
                console.warn(`Skipping entrypoint "${entrypoint}" on ${scid} to avoid wallet permission prompt.`);
                return { error: 'entrypoint_requires_permission', scid, entrypoint };
            }
            
            // Try multiple parameter formats as some wallets might need different formats
            let params = { scid: scid, code: false, variables: true };
            console.log('Querying SC state via DERO.GetSC:', scid, 'with params:', JSON.stringify(params));
            let result = await this.sendRequest('DERO.GetSC', params);
            
            console.log('📨 SC Query Response (DERO.GetSC):', JSON.stringify(result).substring(0, 500));
            
            const hasState = (result?.result?.stringkeys || result?.result?.uint64keys || 
                             result?.stringkeys || result?.uint64keys);
            
            if (!hasState) {
                console.warn('⚠️ [GetSC] No contract state in response, trying alternative formats...');
                
                // Try 1: Just variables: true (no code parameter)
                try {
                    params = { scid: scid, variables: true };
                    console.log('📤 [GetSC] Trying alternative format 1:', JSON.stringify(params));
                    const altResult1 = await this.sendRequest('DERO.GetSC', params);
                    console.log('📨 [GetSC] Alternative format 1 response:', JSON.stringify(altResult1).substring(0, 500));
                    
                    const hasState1 = (altResult1?.result?.stringkeys || altResult1?.result?.uint64keys || 
                                      altResult1?.stringkeys || altResult1?.uint64keys);
                    if (hasState1) {
                        console.log('✅ [GetSC] Alternative format 1 returned contract state!');
                        return altResult1;
                    }
                } catch (e) {
                    console.warn('⚠️ [GetSC] Alternative format 1 failed:', e.message);
                }
                
                // Try 2: All parameters as strings (some wallets might need this)
                try {
                    params = { scid: scid, code: "false", variables: "true" };
                    console.log('📤 [GetSC] Trying alternative format 2:', JSON.stringify(params));
                    const altResult2 = await this.sendRequest('DERO.GetSC', params);
                    console.log('📨 [GetSC] Alternative format 2 response:', JSON.stringify(altResult2).substring(0, 500));
                    
                    const hasState2 = (altResult2?.result?.stringkeys || altResult2?.result?.uint64keys || 
                                      altResult2?.stringkeys || altResult2?.uint64keys);
                    if (hasState2) {
                        console.log('✅ [GetSC] Alternative format 2 returned contract state!');
                        return altResult2;
                    }
                } catch (e) {
                    console.warn('⚠️ [GetSC] Alternative format 2 failed:', e.message);
                }
                
                const isEngram = this.isEngram || false;
                const warningMsg = isEngram
                    ? '⚠️ [GetSC] Engram XSWD is known to have limitations with DERO.GetSC - it may not return contract state variables (stringkeys/uint64keys) even when the contract has state. Try using the DERO CLI wallet (simple-wallet) for contract state queries.'
                    : '⚠️ [GetSC] All parameter formats failed to return contract state. Wallet may not support returning contract variables via XSWD.';
                console.warn(warningMsg);
            }
            
            return result;
        } catch (error) {
            console.error('Failed to get SC state:', error);
            return { error: error.message };
        }
    };
}

// Test Query Marketplace Orders
async function testQueryMarketplaceOrders() {
    if (!window.checkWalletConnection || !window.checkWalletConnection()) return;
    
    try {
        const marketScid = document.getElementById('marketplaceScid').value.trim();
        const assetScid = document.getElementById('orderAssetScid').value.trim() || null;
        
        if (!marketScid || marketScid.length !== 64) {
            alert('Invalid marketplace SCID. Must be 64 hex characters.');
            return;
        }

        if (window.logEngramResponse) {
            window.logEngramResponse({ method: 'Query Marketplace Orders', params: { marketScid, assetScid }, status: 'querying...' });
        }
        
        // Get marketplace contract state - try multiple parameter formats
        // Some wallets might need different parameter formats
        let scResult = null;
        let lastError = null;
        
        // Try 1: Standard format (code: false, variables: true)
        try {
            scResult = await window.app.deroWallet.ws.getSC(marketScid, false, true);
        } catch (e) {
            lastError = e;
        }
        
        // Try 2: Direct DERO.GetSC call with explicit parameters
        if (!scResult || (!scResult.result?.stringkeys && !scResult.result?.uint64keys && !scResult.stringkeys && !scResult.uint64keys)) {
            try {
                const directResult = await window.app.deroWallet.ws.sendRequest('DERO.GetSC', {
                    scid: marketScid,
                    code: false,
                    variables: true
                });
                if (directResult?.result?.stringkeys || directResult?.result?.uint64keys || 
                    directResult?.stringkeys || directResult?.uint64keys) {
                    scResult = directResult;
                }
            } catch (e) {
                lastError = e;
            }
        }
        
        // Try 3: Alternative parameter format (just variables, no code parameter)
        if (!scResult || (!scResult.result?.stringkeys && !scResult.result?.uint64keys && !scResult.stringkeys && !scResult.uint64keys)) {
            try {
                const altResult = await window.app.deroWallet.ws.sendRequest('DERO.GetSC', {
                    scid: marketScid,
                    variables: true
                });
                if (altResult?.result?.stringkeys || altResult?.result?.uint64keys || 
                    altResult?.stringkeys || altResult?.uint64keys) {
                    scResult = altResult;
                }
            } catch (e) {
                lastError = e;
            }
        }

        // Try 4: Use keysstring to fetch specific keys (owner/order counters) - often works on CLI
        if (!scResult || (!scResult.result?.stringkeys && !scResult.result?.uint64keys && !scResult.stringkeys && !scResult.uint64keys)) {
            try {
                const keysResult = await window.app.deroWallet.ws.sendRequest('DERO.GetSC', {
                    scid: marketScid,
                    code: false,
                    variables: false,
                    keysstring: ['owner', 'order_counter', 'listingCounter', 'buyCounter']
                });
                if (keysResult?.result?.stringkeys || keysResult?.result?.uint64keys || 
                    keysResult?.stringkeys || keysResult?.uint64keys) {
                    scResult = keysResult;
                }
            } catch (e) {
                lastError = e;
            }
        }
        
        // If still no result, use the first one we got (even if empty)
        if (!scResult && lastError) {
            throw lastError;
        }
        
        // Try multiple response structure formats
        let scData = scResult;
        if (scResult?.result) {
            scData = scResult.result;
        } else if (scResult?.data) {
            scData = scResult.data;
        }
        
        // Check for stringkeys/uint64keys in various locations
        let stringKeys = scData?.stringkeys || scData?.stringKeys || {};
        let uint64Keys = scData?.uint64keys || scData?.uint64Keys || {};
        
        // If still empty, check if they're nested differently
        if (Object.keys(stringKeys).length === 0 && Object.keys(uint64Keys).length === 0) {
            // Try checking result.result.result (nested)
            if (scResult?.result?.result) {
                const nested = scResult.result.result;
                stringKeys = nested?.stringkeys || nested?.stringkeys || nested?.stringKeys || {};
                uint64Keys = nested?.uint64keys || nested?.uint64Keys || {};
            }
            // Try checking if data is in a different format
            if (scData?.data) {
                stringKeys = scData.data?.stringkeys || scData.data?.stringkeys || scData.data?.stringKeys || {};
                uint64Keys = scData.data?.uint64keys || scData.data?.uint64Keys || {};
            }
        }
        
        // If still no keys, log the entire structure for debugging
        if (Object.keys(stringKeys).length === 0 && Object.keys(uint64Keys).length === 0) {
            // Check contract balance to see if tokens are actually there
            let contractBalance = 0;
            try {
                contractBalance = await window.app.deroWallet.getBalance(null, marketScid);
            } catch (e) {
                // Ignore balance check errors
            }
            
            // Determine likely cause - detect Engram by checking wallet type
            const walletWs = window.app?.deroWallet?.ws;
            const wsUrl = walletWs?.walletWsUrl || '';
            const isEngram = walletWs?.isEngram || wsUrl.includes(':44326');
            const isCLI = wsUrl.includes(':10103') || wsUrl.includes(':40403');
            const walletType = isCLI ? 'CLI (simple-wallet)' : isEngram ? 'Engram (XSWD)' : 'Unknown';
            const likelyCause = isEngram 
                ? 'Engram XSWD is known to have limitations with DERO.GetSC - it may not return contract state variables (stringkeys/uint64keys) even when the contract has state. Try using the DERO CLI wallet (simple-wallet) for contract state queries, or use a blockchain explorer to verify contract state.'
                : 'The wallet may not support returning full contract state via XSWD, or the contract may not be initialized/have no orders.';
                
                if (window.logEngramResponse) {
                    window.logEngramResponse({
                        method: 'Query Marketplace Orders',
                        error: 'No contract state found',
                        details: {
                            marketScid: marketScid,
                            responseStructure: scResult,
                            contractBalance: scData?.balance || 0,
                            contractDeroBalance: contractBalance,
                            contractStatus: scData?.status || 'unknown',
                            walletType: walletType,
                            note: likelyCause,
                            troubleshooting: [
                                '1. Verify contract SCID is correct',
                                '2. Check if contract is initialized (should have "owner" key)',
                                '3. If using Engram, try DERO CLI wallet (simple-wallet) instead',
                                '4. Use a blockchain explorer to verify contract state on-chain',
                                '5. Check wallet logs for XSWD errors'
                            ]
                        }
                    });
                }
                return;
            }
        
        // Helper to decode hex strings
        const decodeS = (key) => {
            const raw = stringKeys[key];
            if (!raw) return '';
            try {
                if (window.app && window.app.decodeHexString) {
                    return window.app.decodeHexString(raw);
                }
                return raw;
            } catch {
                return raw;
            }
        };
        
        const decodeU = (key) => {
            // Check uint64Keys first (direct numeric value)
            if (uint64Keys[key] !== undefined) {
                const v = parseInt(uint64Keys[key], 10);
                return Number.isNaN(v) ? 0 : v;
            }
            // Check stringKeys (might be hex-encoded or plain string)
            const raw = stringKeys[key];
            if (!raw) return 0;
            try {
                // Try to decode hex string first
                let decoded = raw;
                if (window.app && window.app.decodeHexString) {
                    try {
                        decoded = window.app.decodeHexString(raw);
                    } catch (e) {
                        // If hex decode fails, use raw value
                        decoded = raw;
                    }
                }
                // Try parsing as integer
                const p = parseInt(decoded, 10);
                if (!Number.isNaN(p)) {
                    return p;
                }
                // If parsing fails, try parsing the raw hex string directly
                if (/^[0-9a-fA-F]+$/.test(raw) && raw.length > 0) {
                    const hexParsed = parseInt(raw, 16);
                    if (!Number.isNaN(hexParsed)) {
                        return hexParsed;
                    }
                }
                return 0;
            } catch {
                return 0;
            }
        };
        
        // Detect marketplace type by checking for key patterns
        // G45 marketplace has: listingCounter, buyCounter, owner, treasury, feeBps
        // Token marketplace has: order_counter, sell_order_*, buy_order_*
        const hasListingKeys = Object.keys(stringKeys).some(k => k.toLowerCase().startsWith('listing_')) || 
                              Object.keys(uint64Keys).some(k => k.toLowerCase().startsWith('listing_'));
        const hasSellOrderKeys = Object.keys(stringKeys).some(k => k.toLowerCase().startsWith('sell_order_')) ||
                                 Object.keys(uint64Keys).some(k => k.toLowerCase().startsWith('sell_order_'));
        
        // Check for G45 marketplace indicators (counter keys)
        const hasListingCounter = stringKeys.hasOwnProperty('listingCounter') || uint64Keys.hasOwnProperty('listingCounter');
        const hasBuyCounter = stringKeys.hasOwnProperty('buyCounter') || uint64Keys.hasOwnProperty('buyCounter');
        const hasOrderCounter = stringKeys.hasOwnProperty('order_counter') || uint64Keys.hasOwnProperty('order_counter');
        
        // G45 marketplace: has listingCounter/buyCounter OR has listing_* keys
        // Token marketplace: has order_counter OR has sell_order_* keys
        const isG45Marketplace = (hasListingCounter || hasBuyCounter || hasListingKeys) && !hasSellOrderKeys && !hasOrderCounter;
        const isTokenMarketplace = hasOrderCounter || (hasSellOrderKeys && !hasListingCounter && !hasBuyCounter);
        
        const sellOrders = [];
        const buyOrders = [];
        
        // Initialize counters at top level so they're available for logging
        let listingCounter = 0;
        let buyCounter = 0;
        let orderCounter = 0;
        
        if (isG45Marketplace) {
            // G45 Marketplace uses: listing_<id>_<field> keys
            listingCounter = decodeU('listingCounter');
            buyCounter = decodeU('buyCounter');
            const maxListingId = Math.min(listingCounter || 1000, 1000);
            const maxBuyId = Math.min(buyCounter || 1000, 1000);
            
            // Scan G45 listings (format: listing_<id>_<field>)
            for (let id = 1; id <= maxListingId; id++) {
                const seller = decodeS(`listing_${id}_seller`);
                const assetScid = decodeS(`listing_${id}_asset`);
                const status = decodeU(`listing_${id}_status`); // 0 = active, 1 = filled, 2 = cancelled
                
                if (seller && assetScid) {
                    const order = {
                        id: id,
                        seller: seller,
                        assetScid: assetScid,
                        tokenId: decodeU(`listing_${id}_token`),
                        price: decodeU(`listing_${id}_price`),
                        expire: decodeU(`listing_${id}_expire`),
                        status: status === 0 ? 'active' : status === 1 ? 'filled' : 'cancelled',
                        statusRaw: status
                    };
                    sellOrders.push(order);
                }
            }
            
            // Scan G45 buy orders (format: buy_<id>_<field> or similar)
            // Note: G45 might use different format for buy orders - check contract
            for (let id = 1; id <= maxBuyId; id++) {
                const buyer = decodeS(`buy_${id}_buyer`);
                const assetScid = decodeS(`buy_${id}_asset`);
                const status = decodeU(`buy_${id}_status`);
                
                if (buyer && assetScid) {
                    const order = {
                        id: id,
                        buyer: buyer,
                        assetScid: assetScid,
                        tokenId: decodeU(`buy_${id}_token`),
                        price: decodeU(`buy_${id}_price`),
                        status: status === 0 ? 'active' : status === 1 ? 'filled' : 'cancelled',
                        statusRaw: status
                    };
                    buyOrders.push(order);
                }
            }
        } else if (isTokenMarketplace) {
            // Token marketplace uses: sell_order_* and buy_order_* keys
            orderCounter = decodeU('order_counter');
            const maxScan = Math.min(orderCounter || 1000, 1000);
            
            // Scan sell orders (format: sell_order_<field>_<id>)
            for (let id = 1; id <= maxScan; id++) {
                const seller = decodeS(`sell_order_seller_${id}`);
                const tokenScid = decodeS(`sell_order_token_${id}`);
                const status = decodeS(`sell_order_status_${id}`);
                
                if (seller && tokenScid && status) {
                    const order = {
                        id: id,
                        seller: seller,
                        tokenScid: tokenScid,
                        amount: decodeU(`sell_order_amount_${id}`),
                        price: decodeU(`sell_order_price_${id}`),
                        status: status,
                        created: decodeU(`sell_order_created_${id}`)
                    };
                    sellOrders.push(order);
                }
            }
            
            // Scan buy orders (format: buy_order_<field>_<id>)
            for (let id = 1; id <= maxScan; id++) {
                const buyer = decodeS(`buy_order_buyer_${id}`);
                const tokenScid = decodeS(`buy_order_token_${id}`);
                const status = decodeS(`buy_order_status_${id}`);
                
                if (buyer && tokenScid && status) {
                    const order = {
                        id: id,
                        buyer: buyer,
                        tokenScid: tokenScid,
                        amount: decodeU(`buy_order_amount_${id}`),
                        price: decodeU(`buy_order_price_${id}`),
                        status: status,
                        created: decodeU(`buy_order_created_${id}`)
                    };
                    buyOrders.push(order);
                }
            }
        } else {
            // Unknown format - try both
            
            // Try G45 format
            listingCounter = decodeU('listingCounter');
            for (let id = 1; id <= Math.min(listingCounter || 100, 100); id++) {
                const seller = decodeS(`listing_${id}_seller`);
                const assetScid = decodeS(`listing_${id}_asset`);
                if (seller && assetScid) {
                    sellOrders.push({
                        id: id,
                        seller: seller,
                        assetScid: assetScid,
                        tokenId: decodeU(`listing_${id}_token`),
                        price: decodeU(`listing_${id}_price`),
                        status: decodeU(`listing_${id}_status`) === 0 ? 'active' : 'inactive'
                    });
                }
            }
            
            // Try Token format
            orderCounter = decodeU('order_counter');
            for (let id = 1; id <= Math.min(orderCounter || 100, 100); id++) {
                const seller = decodeS(`sell_order_seller_${id}`);
                const tokenScid = decodeS(`sell_order_token_${id}`);
                if (seller && tokenScid) {
                    sellOrders.push({
                        id: id,
                        seller: seller,
                        tokenScid: tokenScid,
                        price: decodeU(`sell_order_price_${id}`),
                        status: decodeS(`sell_order_status_${id}`) || 'unknown'
                    });
                }
            }
        }
        
        // Filter by asset SCID if provided
        let filteredSellOrders = sellOrders;
        let filteredBuyOrders = buyOrders;
        if (assetScid) {
            const assetLower = assetScid.toLowerCase();
            filteredSellOrders = sellOrders.filter(o => {
                // G45 uses assetScid, Token uses tokenScid
                const scid = o.assetScid || o.tokenScid;
                return scid && scid.toLowerCase() === assetLower;
            });
            filteredBuyOrders = buyOrders.filter(o => {
                const scid = o.assetScid || o.tokenScid;
                return scid && scid.toLowerCase() === assetLower;
            });
        }
        
                // Additional diagnostic: Check contract's token balances
                const contractTokenBalances = {};
                if (window.app && window.app.deroWallet && window.app.deroWallet.getBalance && assetScid && assetScid.length === 64) {
                    try {
                        const tokenBalance = await window.app.deroWallet.getBalance(marketScid, assetScid);
                        contractTokenBalances[assetScid] = tokenBalance;
                    } catch (e) {
                        // Ignore balance check errors
                    }
                }
        
        if (window.logEngramResponse) {
            window.logEngramResponse({
                method: 'Query Marketplace Orders',
                params: { marketScid, assetScid },
                contractState: {
                    orderCounter: orderCounter,
                    listingCounter: listingCounter,
                    buyCounter: buyCounter,
                    hasStringKeys: Object.keys(stringKeys).length > 0,
                    hasUint64Keys: Object.keys(uint64Keys).length > 0,
                    stringKeyCount: Object.keys(stringKeys).length,
                    uint64KeyCount: Object.keys(uint64Keys).length,
                    contractBalance: scData?.balance || 0,
                    contractStatus: scData?.status || 'unknown',
                    contractTokenBalances: contractTokenBalances
                },
                marketplaceType: isG45Marketplace ? 'G45' : isTokenMarketplace ? 'Token' : 'Unknown',
                orders: {
                    sellOrders: filteredSellOrders,
                    buyOrders: filteredBuyOrders,
                    totalSellOrders: filteredSellOrders.length,
                    totalBuyOrders: filteredBuyOrders.length
                },
                summary: {
                    sellOrdersFound: filteredSellOrders.length,
                    buyOrdersFound: filteredBuyOrders.length,
                    note: `Found ${filteredSellOrders.length} sell order(s) and ${filteredBuyOrders.length} buy order(s)${assetScid ? ' for this asset' : ''}. ${Object.keys(stringKeys).length === 0 && Object.keys(uint64Keys).length === 0 ? '⚠️ WARNING: No contract state keys found - wallet may not be returning full contract state.' : ''}`
                }
            });
        }
    } catch (error) {
        if (window.logEngramResponse) {
            window.logEngramResponse({ 
                method: 'Query Marketplace Orders', 
                error: error.message || error,
                stack: error.stack 
            });
        }
    }
}

// Expose globally
if (typeof window !== 'undefined') {
    window.testQueryMarketplaceOrders = testQueryMarketplaceOrders;
}
