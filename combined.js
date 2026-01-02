/**
 * Combined JavaScript for ORED-asset-manager
 * Includes: DeroWallet, WebSocketManager, UI Fixes
 */

/**
 * Dero Wallet Integration
 * Simplified Dero Wallet implementation for Tela sites
 */

class DeroWallet {
    constructor() {
        this.provider = null;
        this.isConnected = false;
        this.accounts = [];
        this.currentAccount = null;
        this.eventHandlers = new Map();
        this.ws = null; // WebSocket connection
    }

    // Event emitter methods
    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => handler(data));
        }
    }

    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    async initialize() {
        try {
            this.provider = await this.getProvider();
            if (this.provider) {
                this.isConnected = true;
                console.log('✅ Dero Wallet initialized:', this.provider.type);
                return true;
            } else {
                this.isConnected = false;
                return false;
            }
        } catch (error) {
            console.error('Failed to initialize Dero Wallet:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async getProvider() {
        console.log('🔍 Looking for DERO wallet provider (XSWD mode)...');
        
        // For Engram desktop app with XSWD, we don't need browser extension detection
        // The WebSocket connection to localhost:44326/xswd will handle everything
        console.log('🌐 Using XSWD WebSocket connection to Engram desktop app');
        
        // Return a mock provider object for XSWD mode
        // All actual operations will be done via WebSocket
        const provider = {
            isXSWD: true,
            type: 'XSWD',
            description: 'Engram desktop app via XSWD WebSocket'
        };
        console.log('✅ Returning XSWD provider:', provider);
        return provider;
    }
    

    // Debug functions removed for production

    async requestAccounts() {
        try {
            console.log('Requesting accounts from DERO wallet via WebSocket...');
            
            // Use WebSocket only (TELATOMIC method - no RPC required)
            if (!this.ws || !this.ws.isConnected || !this.ws.isAuthenticated) {
                throw new Error('WebSocket not connected. Please connect wallet first.');
            }

            console.log('Getting accounts via WebSocket (TELATOMIC method)...');
            
            // Wait for address event instead of sending new request
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Request timeout - no address received'));
                }, 10000);
                
                // Listen for address event
                const onAddress = (address) => {
                    clearTimeout(timeout);
                    // Remove the event listener using off method
                    if (this.ws && this.ws.off) {
                        this.ws.off('address', onAddress);
                    }
                    
                    const accounts = [address];
                    this.accounts = accounts;
                    this.currentAccount = accounts[0];
                    this.emit('accountsChanged', accounts);
                    console.log('✅ Got account via WebSocket event:', accounts[0]);
                    resolve(accounts);
                };
                
                this.ws.on('address', onAddress);
            });
        } catch (error) {
            console.error('Failed to request accounts:', error);
            throw error;
        }
    }
    
    // Initialize WebSocket connection
    setWebSocket(ws) {
        this.ws = ws;
    }

    async getAccounts() {
        try {
            // Use WebSocket for accounts (TELATOMIC method - no RPC required)
            if (!this.ws || !this.ws.isConnected || !this.ws.isAuthenticated) {
                throw new Error('WebSocket not connected. Please connect wallet first.');
            }

            console.log('Getting accounts via WebSocket (TELATOMIC method)...');
            const result = await this.ws.sendRequest('GetAddress');
            if (result && result.address) {
                const accounts = [result.address];
                this.accounts = accounts;
                this.currentAccount = accounts[0];
                return accounts;
            } else {
                throw new Error('No address received from wallet.');
            }
        } catch (error) {
            console.error('Failed to get accounts:', error);
            throw error;
        }
    }

    async sendTransaction(transaction) {
        try {
            // Use WebSocket for transaction (TELATOMIC method - no RPC required)
            if (!this.ws || !this.ws.isConnected || !this.ws.isAuthenticated) {
                throw new Error('WebSocket not connected. Please connect wallet first.');
            }

            console.log('Sending transaction via WebSocket (TELATOMIC method)...');
            const result = await this.ws.sendRequest('SendTransaction', { transaction });
            this.emit('transactionSent', { txHash: result.txid, transaction });
            return result.txid;
        } catch (error) {
            console.error('Failed to send transaction:', error);
            throw error;
        }
    }

    async signMessage(message, address) {
        try {
            // Use WebSocket for signing (TELATOMIC method - no RPC required)
            if (!this.ws || !this.ws.isConnected || !this.ws.isAuthenticated) {
                throw new Error('WebSocket not connected. Please connect wallet first.');
            }

            console.log('Signing message via WebSocket (TELATOMIC method)...');
            const result = await this.ws.sendRequest('SignMessage', { message, address });
            return result.signature;
        } catch (error) {
            console.error('Failed to sign message:', error);
            throw error;
        }
    }

    async signTransaction(transaction) {
        try {
            // Use WebSocket for signing (TELATOMIC method - no RPC required)
            if (!this.ws || !this.ws.isConnected || !this.ws.isAuthenticated) {
                throw new Error('WebSocket not connected. Please connect wallet first.');
            }

            console.log('Signing transaction via WebSocket (TELATOMIC method)...');
            const result = await this.ws.sendRequest('SignTransaction', { transaction });
            return result.signedTransaction;
        } catch (error) {
            console.error('Failed to sign transaction:', error);
            throw error;
        }
    }


    // Utility methods
    isValidAddress(address) {
        return address && address.length >= 64 && /^[0-9a-fA-F]+$/.test(address);
    }

    formatAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 8)}...${address.substring(address.length - 8)}`;
    }

    formatBalance(balance) {
        if (!balance) return '0.0000';
        return (balance / 100000).toFixed(4);
    }

    getCurrentAccount() {
        return this.currentAccount;
    }

    async getBalance(address, scid = null) {
        if (!this.ws) {
            throw new Error('WebSocket not connected');
        }

        // XSWD GetBalance with SCID: Private asset ownership check
        // Reference: https://tela.derod.org/xswd
        // 
        // When SCID is provided:
        // - Engram automatically checks the connected wallet's private balance for that SCID
        // - No address parameter needed - Engram uses the connected wallet automatically
        // - Balance > 0 means the connected wallet owns that asset privately
        // - No unlock/decrypt needed - Engram handles private balance checks internally
        // - The wallet address itself doesn't matter - only if connected wallet has balance
        if (scid) {
            const normalizedScid = scid.toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(normalizedScid)) {
                console.warn(`⚠️ Invalid SCID format for GetBalance: ${scid.substring(0, 16)}...`);
                return 0;
            }
            
            // Check WebSocket connection before attempting request
            // this.ws is the WebSocketManager instance, check its connection state
            if (!this.ws || !this.ws.isConnected || !this.ws.isAuthenticated) {
                console.warn('⚠️ [GetBalance] WebSocket not connected or not authenticated. Please reconnect your wallet.');
                return 0;
            }
            
            // Also check the underlying WebSocket readyState
            if (!this.ws.ws || this.ws.ws.readyState !== WebSocket.OPEN) {
                console.warn('⚠️ [GetBalance] Underlying WebSocket not open. Please reconnect your wallet.');
                return 0;
            }
            
            console.log(`🔍 [GetBalance] Checking private balance for SCID: ${normalizedScid.substring(0, 16)}... (connected wallet)`);
            
            // Retry logic: GetBalance with SCID can be unreliable due to wallet sync/permission issues
            // Retry up to 3 times with exponential backoff
            const maxRetries = 3;
            let lastError = null;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    // Only send SCID - Engram uses connected wallet automatically
                    // No additional parameters needed - format is: { scid: "..." }
                    const result = await this.ws.sendRequest('GetBalance', { scid: normalizedScid });
                    
                    // Check for error in response
                    if (result?.error) {
                        const errorMsg = result.error.message || result.error.code || 'Unknown error';
                        console.warn(`⚠️ [GetBalance] Attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);
                        lastError = new Error(`GetBalance error: ${errorMsg}`);
                        
                        // If permission denied, don't retry
                        if (errorMsg.includes('Permission') || errorMsg.includes('permission') || result.error.code === -32043) {
                            console.warn(`⚠️ [GetBalance] Permission denied - not retrying`);
                            return 0;
                        }
                        
                        // Retry with exponential backoff (except on last attempt)
                        if (attempt < maxRetries) {
                            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s max
                            console.log(`⏳ [GetBalance] Retrying in ${delay}ms...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }
                    }
                    
                    // Extract balance from response
                    const balance = result?.balance ?? result?.result?.balance ?? 0;
                    const unlockedBalance = result?.unlocked_balance ?? result?.result?.unlocked_balance ?? balance;
                    
                    if (attempt > 1) {
                        console.log(`✅ [GetBalance] Success on attempt ${attempt}/${maxRetries}`);
                    }
                    
                    console.log(`📊 [GetBalance] SCID balance result: ${balance} (unlocked: ${unlockedBalance}) (${balance > 0 ? 'OWNED' : 'not owned'})`);
                    return balance;
                    
                } catch (error) {
                    lastError = error;
                    const errorMsg = error?.message || error?.error?.message || 'Unknown error';
                    console.warn(`⚠️ [GetBalance] Attempt ${attempt}/${maxRetries} exception: ${errorMsg}`);
                    
                    // If permission denied, don't retry
                    if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
                        console.warn(`⚠️ [GetBalance] Permission denied - not retrying`);
                        return 0;
                    }
                    
                    // Retry with exponential backoff (except on last attempt)
                    if (attempt < maxRetries) {
                        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s max
                        console.log(`⏳ [GetBalance] Retrying in ${delay}ms after exception...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }
            }
            
            // All retries failed
            console.error(`❌ [GetBalance] All ${maxRetries} attempts failed. Last error:`, lastError?.message || 'Unknown error');
            return 0;
        }

        // For wallet DERO balance (no SCID), use address if provided
        const params = address ? { address: address } : {};
        const result = await this.ws.sendRequest('GetBalance', params);
        return result?.balance || result?.result?.balance || 0;
    }

    // Gnomon.GetOwner - Get smart contract owner via Gnomon indexer
    // This can determine private ownership if Gnomon has indexed the owner
    async getSCOwner(scid) {
        if (!this.ws) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            const normalizedScid = scid.toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(normalizedScid)) {
                return null;
            }
            
            console.log(`🔍 [Gnomon.GetOwner] Checking owner for SCID: ${normalizedScid.substring(0, 16)}...`);
            const result = await this.ws.sendRequest('Gnomon.GetOwner', { scid: normalizedScid });
            // Gnomon returns {getOwner: "address"} format
            const owner = result?.getOwner || result?.owner || result?.result?.getOwner || result?.result?.owner || null;
            
            if (owner) {
                console.log(`✅ [Gnomon.GetOwner] Owner found: ${owner.substring(0, 20)}...`);
            } else {
                console.log(`⚠️ [Gnomon.GetOwner] No owner found for SCID`);
            }
            
            return owner;
        } catch (error) {
            console.warn(`⚠️ [Gnomon.GetOwner] Failed:`, error.message);
            return null;
        }
    }

    async getAssets(address) {
        try {
            // Use WebSocket for assets (DERO protocol method)
            if (!this.ws) {
                throw new Error('WebSocket not connected. Please connect wallet first.');
            }

            console.log('Getting assets via WebSocket...');
            // Use DERO GetTransfers method to get asset transfers
            // Include all types: in, out, and coinbase (mint transactions)
            const result = await this.ws.sendRequest('GetTransfers', {
                in: true,
                out: true,
                coinbase: true,
                sc: true,  // Include smart contract data (destinations, payload_rpc, sc_rpc)
                min_height: 0,
                max_height: 0  // 0 means no limit
            });
            
            // Handle the response format: {"jsonrpc":"2.0","id":"3","result":{}}
            if (result && result.result) {
                // Check if transfers exist
                if (result.result.transfers && Array.isArray(result.result.transfers)) {
                    console.log('✅ Transfers received from WebSocket:', result.result.transfers.length);
                    // Return all transfers - let the parser decide what's an NFT
                    return result.result.transfers;
                } else if (result.result.entries && Array.isArray(result.result.entries)) {
                    // Alternative format: entries instead of transfers
                    console.log('✅ Transfers received from WebSocket (entries format):', result.result.entries.length);
                    return result.result.entries;
                } else {
                    console.log('⚠️ No transfers array in result, but result exists:', result.result);
                    // Return empty array - no transfers yet
                    return [];
                }
            }
            console.log('⚠️ No result in response:', result);
            return [];
        } catch (error) {
            console.error('Failed to get assets:', error);
            return [];
        }
    }

    isConnected() {
        return this.isConnected && this.provider && this.accounts.length > 0;
    }
}

/**
 * WebSocket Connection Manager
 * Handles real-time communication with Dero blockchain via WebSockets
 * Supports DERO WebSocket protocol for wallet operations
 */

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.subscriptions = new Set();
        this.eventHandlers = new Map();
        // TELATOMIC-style request handling
        this.callId = 1;
        this.globalResolutions = [];
        this.callStack = [];
        this.isAuthenticated = false; // Track XSWD authentication state
        
        // XSWD Improvements: Rate limiting and request queuing
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.lastCallTime = 0;
        // TELA XSWD Advanced pattern: Rate limiting to prevent Engram overload
        // Based on: https://tela.derod.org/templates/xswd-advanced
        // Reduced to 100ms to match Engram Calls tab behavior (which works reliably)
        this.MIN_CALL_INTERVAL = 100; // 100ms between calls (10 calls/second max - prevents Engram spam)
        this.maxConcurrentRequests = 1; // Only one request at a time (prevents Engram overload)
        this.activeRequests = 0;
        
        // XSWD Improvements: Multi-endpoint fallback
        // CLI wallet is default (better contract state support), Engram as fallback
        // Note: CLI wallet typically uses port 44326 (same as Engram), detection happens via response
        this.endpoints = [
            'ws://localhost:44326/xswd', // CLI wallet or Engram (primary - try CLI first)
            'ws://localhost:10103/xswd', // Alternative CLI wallet port
            'ws://localhost:40403/xswd'  // Alternative CLI wallet port
        ];
        this.currentEndpointIndex = 0;
        this.walletWsUrl = this.endpoints[0]; // Default to first endpoint (44326 - CLI or Engram)
        
        // XSWD Improvements: Auto-reconnection
        this.userDisconnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimer = null;
        
        // Signed app data for simple-wallet support
        this.signedAppData = null;
        this.loadSignedAppData();
    }
    
    // Load signed app data if available (for simple-wallet)
    async loadSignedAppData() {
        try {
            // Try to fetch appData.txt.signed from the server
            // This is optional - only needed for simple-wallet, not Engram
            const response = await fetch('appData.txt.signed');
            if (response.ok) {
                const signedData = await response.text();
                // Parse the signed message format
                const lines = signedData.trim().split('\n');
                let address = '';
                let c = '';
                let s = '';
                let data = '';
                let inMessage = false;
                
                for (const line of lines) {
                    if (line.includes('Address:')) {
                        address = line.split('Address:')[1].trim();
                    } else if (line.startsWith('C:')) {
                        c = line.split('C:')[1].trim();
                    } else if (line.startsWith('S:')) {
                        s = line.split('S:')[1].trim();
                    } else if (line.includes('BEGIN DERO SIGNED MESSAGE')) {
                        inMessage = true;
                    } else if (line.includes('END DERO SIGNED MESSAGE')) {
                        inMessage = false;
                    } else if (inMessage && line.trim() && !line.includes('Address:') && !line.startsWith('C:') && !line.startsWith('S:')) {
                        data += line.trim();
                    }
                }
                
                // Reconstruct the signature
                const signature = `-----BEGIN DERO SIGNED MESSAGE-----\nAddress: ${address}\nC: ${c}\nS: ${s}\n${data}\n-----END DERO SIGNED MESSAGE-----`;
                
                // Read appData.txt for the app ID and metadata
                try {
                    const appDataResponse = await fetch('appData.txt');
                    if (appDataResponse.ok) {
                        const appDataText = await appDataResponse.text();
                        const appDataLines = appDataText.trim().split('\n');
                        const appId = appDataLines[0] || '';
                        const appName = appDataLines[1] || 'ORED-asset-manager';
                        const appDesc = appDataLines[2] || 'asset manager built for DERO';
                        
                        // Use origin to avoid protocol issues with Engram
                        const siteOrigin = window.location.origin || (window.location.protocol + '//' + window.location.host);
                        this.signedAppData = {
                            id: appId,
                            name: appName,
                            description: appDesc,
                            url: siteOrigin,
                            permissions: {
                                GetHeight: 4, // always deny
                                GetAddress: 3, // always allow
                                GetTransfers: 1, // allow
                                transfer: 2, // deny (will ask each time)
                                GetBalance: 0, // ask
                                'DERO.GetSC': 1, // allow (view-only)
                                'Gnomon.GetOwner': 1 // allow
                            },
                            signature: btoa(signature)
                        };
                        console.log('✅ Loaded signed app data for simple-wallet');
                    } else {
                        // File doesn't exist - this is normal for Engram, only needed for simple-wallet
                        console.log('ℹ️ appData.txt not found (optional - only needed for simple-wallet)');
                    }
                } catch (appDataError) {
                    console.warn('Could not load appData.txt:', appDataError);
                }
            } else {
                // File doesn't exist - this is normal for Engram, only needed for simple-wallet
                console.log('ℹ️ appData.txt.signed not found (optional - only needed for simple-wallet)');
            }
        } catch (error) {
            // Silently handle any other errors - this file is optional
            console.log('ℹ️ No signed app data found, will use TELATOMIC format (Engram)');
        }
    }

    normalizeResponseId(rawId) {
        if (rawId === undefined || rawId === null) return null;
        const normalized = String(rawId).trim();
        return normalized.replace(/^"+|"+$/g, '');
    }

    connect() {
        try {
            // Check if already connected
            if (this.isConnected && this.isAuthenticated) {
                console.log('WebSocket already connected and authenticated');
                this.emit('connected');
                return;
            }
            
            // Reset reconnection state
            this.userDisconnected = false;
            this.reconnectAttempts = 0;
            
            console.log('Attempting to connect to XSWD WebSocket...');
            
            // Try connecting with multi-endpoint fallback
            this.tryConnectWithFallback(0);
        } catch (error) {
            console.error('Failed to connect to XSWD WebSocket:', error);
            this.emit('error', error);
        }
    }
    
    // XSWD Improvement: Multi-endpoint fallback
    tryConnectWithFallback(endpointIndex = 0) {
        if (endpointIndex >= this.endpoints.length) {
            console.error('❌ All XSWD endpoints failed');
            this.emit('error', new Error('All XSWD endpoints failed. Please ensure a DERO wallet is running.'));
            return;
        }
        
        this.currentEndpointIndex = endpointIndex;
        this.walletWsUrl = this.endpoints[endpointIndex];
        console.log(`🌐 Trying endpoint ${endpointIndex + 1}/${this.endpoints.length}: ${this.walletWsUrl}`);
        
        try {
            this.connectToWebSocket(this.walletWsUrl);
        } catch (error) {
            console.warn(`⚠️ Failed to connect to ${this.walletWsUrl}, trying next endpoint...`);
            // Try next endpoint
            setTimeout(() => this.tryConnectWithFallback(endpointIndex + 1), 500);
        }
    }
    
    connectToWebSocket(url) {
        try {
            console.log(`🌐 Connecting to XSWD WebSocket: ${url}`);
            
            this.ws = new WebSocket(url);
            
            // Detect wallet type - CLI can use 44326 (same as Engram), so we detect by behavior
            // Ports 40403 and 10103 are known CLI ports, but CLI can also use 44326
            const isKnownCliPort = url.includes(':40403') || url.includes(':10103');
            this.isEngram = false; // Will be determined by response
            
            this.ws.onopen = async () => {
                console.log('✅ WebSocket connected');
                this.isConnected = true;
                this.isAuthenticated = false;
                
                // Try signed app data first if available (works for CLI on any port including 44326)
                // CLI wallet requires signed app data, Engram accepts TELATOMIC format
                if (this.signedAppData) {
                    console.log('📤 Sending signed app data (CLI wallet format - works on any port)');
                    this.ws.send(JSON.stringify(this.signedAppData));
                } else {
                    // No signed app data available - try TELATOMIC format (Engram)
                    // Generate SHA256 hash for ID (required by XSWD) - using TELATOMIC format for Engram
                    const appName = "ORED-asset-manager";
                    const encoder = new TextEncoder();
                    const dataBuffer = encoder.encode(appName);
                    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const appId = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
                    
                    // Send XSWD application connect message in TELATOMIC format (plain object)
                    // Use origin instead of constructing URL to avoid protocol issues
                    const siteUrl = window.location.origin || (window.location.protocol + '//' + window.location.host);
                    const applicationData = {
                        "id": appId,
                        "name": appName,
                        "description": "asset manager built for DERO",
                        "url": siteUrl
                    };
                    console.log('📤 Sending XSWD application connect in TELATOMIC format (Engram - no signed app data available)');
                    this.ws.send(JSON.stringify(applicationData));
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    console.log('📨 WebSocket message received:', event.data);
                    const response = JSON.parse(event.data);
                    
                    // Enhanced error logging for Engram responses
                    if (response.error) {
                        console.error('❌ [Engram Error Response]', {
                            errorCode: response.error.code,
                            errorMessage: response.error.message,
                            errorData: response.error.data,
                            requestId: response.id,
                            fullResponse: response
                        });
                    }
                
                // Handle XSWD authentication response (both TELATOMIC and signed app data formats)
                if (response.accepted) {
                    // Detect wallet type based on response
                    // If we used signed app data, it's CLI wallet
                    // If we used TELATOMIC, it's Engram
                    if (this.signedAppData) {
                        console.log('✅ XSWD application accepted (CLI wallet):', response.message);
                        this.isEngram = false;
                    } else {
                        console.log('✅ XSWD application accepted (Engram):', response.message);
                        this.isEngram = true;
                    }
                    this.isAuthenticated = true;
                    this.emit('connected');
                    
                    // Request wallet address (TELATOMIC format)
                    // Note: GetTransfers will be requested on-demand when needed (e.g., when loading assets)
                    // This avoids unnecessary permission prompts on every connection
                    console.log('📤 Requesting wallet address...');
                    this.ws.send(JSON.stringify({
                        "jsonrpc": "2.0",
                        "id": "0",
                        "method": "GetAddress"
                    }));
                }
                // Handle CLI wallet rejection (needs signed app data) - can happen on any port including 44326
                else if (response.message && (response.message.includes('rejected') || response.message.includes('Could not connect'))) {
                    // If we tried TELATOMIC and got rejected, it's likely CLI wallet requiring signed app data
                    if (!this.signedAppData) {
                        console.error('❌ Wallet rejected connection: Signed app data required (likely CLI wallet)');
                        console.error('📝 Please generate appData.txt and appData.txt.signed using simple-appData-maker');
                        console.error('📖 See SIMPLE-WALLET-SETUP.md for instructions');
                        this.emit('error', new Error('CLI wallet requires signed app data. Please generate appData.txt.signed using simple-appData-maker. See SIMPLE-WALLET-SETUP.md for instructions.'));
                        this.ws.close();
                        return;
                    } else {
                        console.warn('⚠️ Connection rejected:', response.message);
                        this.emit('error', new Error(response.message || 'Connection rejected by wallet'));
                        this.ws.close();
                        return;
                    }
                }
                // Handle "App ID is already used" - close and reconnect
                else if (response.message && response.message.includes('App ID is already used')) {
                    console.log('⚠️ App ID already used, closing connection to reconnect...');
                    this.ws.close();
                    // Don't reconnect immediately, let the user try again
                    return;
                }
                // Handle wallet address response (TELATOMIC format)
                else if (response.result) {
                    const res = response.result;
                    if (res.address) {
                        console.log('✅ Wallet address received:', res.address);
                        this.emit('address', res.address);
                        
                        // Handle ID "0" response specially (from initial GetAddress request)
                        if (response.id === "0" || response.id === 0) {
                            // Resolve any pending GetAddress request
                            for (const id in this.globalResolutions) {
                                if (this.globalResolutions[id]) {
                                    const currentResolver = this.globalResolutions[id][0];
                                    delete this.globalResolutions[id];
                                    currentResolver(response);
                                    console.log('✅ Resolved GetAddress request with ID 0');
                                    break;
                                }
                            }
                        } else {
                            // Use TELATOMIC's sequential processing for other responses
                            this.handleSequentialResponse(response);
                        }
                    } else {
                        // Handle other responses (like GetBalance, GetTransfers) that don't have address
                        console.log('📨 Processing non-address response:', response);
                        this.handleSequentialResponse(response);
                    }
                }
                // Handle other messages
                else {
                    this.handleMessage(event.data);
                }
                } catch (messageError) {
                    console.error('❌ [XSWD Message Handler Error] Failed to process message:', {
                        error: messageError,
                        message: event.data,
                        stack: messageError.stack
                    });
                    
                    // Log to app debug if available
                    if (window.app && typeof window.app.logDebug === 'function') {
                        window.app.logDebug(`❌ XSWD Message Handler Error: ${messageError.message}`, 'error');
                    }
                    
                    // Don't crash - just log the error
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ [XSWD Error] WebSocket error:', error);
                console.error('❌ [XSWD Error] Connection failed to:', url);
                console.error('❌ [XSWD Error] Make sure your wallet (CLI or Engram) is running with XSWD enabled');
                
                // Auto-disconnect on error to prevent site crash
                // Use setTimeout to prevent blocking and allow error to propagate safely
                setTimeout(() => {
                    try {
                        this.isConnected = false;
                        this.isAuthenticated = false;
                        this.userDisconnected = true; // Prevent auto-reconnect on error
                        
                        // Clear any pending requests to prevent crashes
                        this.requestQueue = [];
                        this.activeRequests = 0;
                        this.isProcessingQueue = false;
                        
                        // Reject all pending promises
                        for (const id in this.globalResolutions) {
                            if (this.globalResolutions[id]) {
                                try {
                                    const resolver = this.globalResolutions[id][0];
                                    delete this.globalResolutions[id];
                                    resolver({ error: { code: -32000, message: 'WebSocket error - connection lost' } });
                                } catch (e) {
                                    console.error('Error rejecting pending promise:', e);
                                }
                            }
                        }
                        
                        // Close the connection gracefully
                        if (this.ws && this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
                            try {
                                this.ws.close(1000, 'XSWD error - auto-disconnecting');
                            } catch (closeError) {
                                console.error('Error closing WebSocket:', closeError);
                            }
                        }
                        
                        // Notify app to update connection status (wrapped in try-catch)
                        try {
                            this.emit('error', error);
                            this.emit('disconnected');
                        } catch (emitError) {
                            console.error('Error emitting disconnect event:', emitError);
                        }
                        
                        // Show notification if app is available (wrapped in try-catch)
                        if (window.app && typeof window.app.showNotification === 'function') {
                            try {
                                window.app.showNotification('Engram connection error. Please reconnect your wallet.', 'error');
                            } catch (e) {
                                console.error('Failed to show error notification:', e);
                            }
                        }
                    } catch (disconnectError) {
                        console.error('❌ [XSWD Error] Error during auto-disconnect:', disconnectError);
                        // Don't re-throw - we're in error handler
                    }
                }, 0);
            };
            
            this.ws.onclose = (event) => {
                console.log(`❌ [XSWD Close] WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'No reason given'}`);
                
                // Use setTimeout to prevent blocking and allow close to propagate safely
                setTimeout(() => {
                    try {
                        this.isConnected = false;
                        this.isAuthenticated = false;
                        
                        // Clear any pending requests to prevent crashes
                        this.requestQueue = [];
                        this.activeRequests = 0;
                        this.isProcessingQueue = false;
                        
                        // Reject all pending promises
                        for (const id in this.globalResolutions) {
                            if (this.globalResolutions[id]) {
                                try {
                                    const resolver = this.globalResolutions[id][0];
                                    delete this.globalResolutions[id];
                                    resolver({ error: { code: -32000, message: 'WebSocket closed - connection lost' } });
                                } catch (e) {
                                    console.error('Error rejecting pending promise on close:', e);
                                }
                            }
                        }
                        
                        // Check for abnormal close codes that indicate Engram crash
                        const abnormalCodes = [1006, 1011, 1012, 1013, 1014, 1015]; // Abnormal closure codes
                        if (abnormalCodes.includes(event.code)) {
                            console.error('⚠️ [XSWD Close] Abnormal WebSocket closure detected - Engram may have crashed');
                            this.userDisconnected = true; // Prevent auto-reconnect on crash
                            
                            if (window.app && typeof window.app.showNotification === 'function') {
                                try {
                                    window.app.showNotification('Engram connection lost. Please reconnect your wallet.', 'error');
                                } catch (e) {
                                    console.error('Failed to show disconnect notification:', e);
                                }
                            }
                        }
                        
                        // Notify app to update connection status (wrapped in try-catch)
                        try {
                            this.emit('disconnected');
                        } catch (emitError) {
                            console.error('Error emitting disconnected event:', emitError);
                        }
                        
                        // XSWD Improvement: Auto-reconnection with exponential backoff
                        // Only auto-reconnect if user didn't explicitly disconnect and it wasn't an abnormal closure
                        if (!this.userDisconnected && event.code !== 1000 && !abnormalCodes.includes(event.code)) {
                            this.scheduleReconnect();
                        } else {
                            console.log('WebSocket closed - manual reconnection required');
                        }
                    } catch (closeError) {
                        console.error('❌ [XSWD Close] Error during close handler:', closeError);
                        // Don't re-throw - we're in close handler
                    }
                }, 0);
            };
        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.emit('error', error);
        }
    }
    
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Check for critical errors that indicate Engram crash/failure
            if (message.error) {
                const errorCode = message.error.code;
                const errorMsg = message.error.message || '';
                
                // Detect critical errors that suggest Engram crash
                if (errorCode === -32603 || // Internal error
                    errorCode === -32000 || // Server error
                    errorMsg.includes('connection') ||
                    errorMsg.includes('timeout') ||
                    errorMsg.includes('closed')) {
                    console.error('⚠️ Critical XSWD error detected - auto-disconnecting:', errorMsg);
                    
                    // Auto-disconnect to prevent site crash
                    try {
                        this.userDisconnected = true;
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.close(1000, 'Critical XSWD error');
                        }
                        this.isConnected = false;
                        this.isAuthenticated = false;
                        this.emit('disconnected');
                        
                        if (window.app && typeof window.app.showNotification === 'function') {
                            try {
                                window.app.showNotification('Engram connection issue detected. Please reconnect.', 'warning');
                            } catch (e) {}
                        }
                    } catch (e) {
                        console.error('Error during critical error disconnect:', e);
                    }
                }
            }
            
            // Handle response messages (TELA pattern: match by ID)
            if (message.id !== undefined) {
                const id = this.normalizeResponseId(message.id); // Normalize to match stored IDs
                if (this.globalResolutions[id]) {
                    const currentResolver = this.globalResolutions[id][0];
                    delete this.globalResolutions[id];
                    
                    // Pass full response to resolver (it will handle error/result)
                    currentResolver(message);
                    return;
                }
            }
            
            // Handle event messages
            if (message.method) {
                switch (message.method) {
                    case 'balance_updated':
                        this.emit('balanceUpdate', message.params);
                        break;
                    case 'new_transaction':
                        this.emit('newTransaction', message.params);
                        break;
                    case 'block_added':
                        this.emit('blockAdded', message.params);
                        break;
                }
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
        }
    }
    
    // TELA-compliant sequential response handling
    handleSequentialResponse(response) {
        const id = this.normalizeResponseId(response.id);
        if (!id || !this.globalResolutions[id]) {
            return;
        }
        
        const currentResolver = this.globalResolutions[id][0];
        this.callStack[id] = response;
        
        // Process responses in order (TELATOMIC pattern)
        const highestSent = Math.max(...Object.keys(this.globalResolutions).map(Number).filter(n => !isNaN(n)));
        if (highestSent === parseInt(id)) {
            delete this.globalResolutions[id];
            delete this.callStack[id];
            if (window.app && typeof window.app.logDebug === 'function') {
                window.app.logDebug(`⬅️ Sequential response [id=${id}]: ${JSON.stringify(response)}`);
            }
            currentResolver(response);
        } else {
            // Process all pending responses in order
            for (const i in this.callStack) {
                if (this.globalResolutions[i]) {
                    const resolver = this.globalResolutions[i][0];
                    const call = this.callStack[i];
                    delete this.globalResolutions[i];
                    delete this.callStack[i];
                    if (window.app && typeof window.app.logDebug === 'function') {
                        window.app.logDebug(`⬅️ Sequential response [id=${i}]: ${JSON.stringify(call)}`);
                    }
                    resolver(call);
                }
            }
        }
    }
    
    // XSWD Improvement: Auto-reconnection with exponential backoff
    scheduleReconnect(attempt = 1) {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
        if (attempt > this.maxReconnectAttempts) {
            console.warn('⚠️ Max reconnection attempts reached');
            return;
        }
        
        const maxDelay = 30000; // 30 seconds max
        const delay = Math.min(Math.pow(2, attempt) * 1000, maxDelay);
        
        console.log(`⏳ Scheduling reconnection attempt ${attempt}/${this.maxReconnectAttempts} in ${delay}ms...`);
        
        this.reconnectTimer = setTimeout(() => {
            if (!this.isConnected && !this.userDisconnected) {
                this.reconnectAttempts = attempt;
                console.log(`🔄 Reconnection attempt ${attempt}...`);
                this.tryConnectWithFallback(0); // Try all endpoints again
            }
        }, delay);
    }
    
    // XSWD Improvement: Get timeout for method (different timeouts for different methods)
    getTimeoutForMethod(method) {
        // Normalize method name to handle case variations
        const methodKey = method && typeof method === 'string' ? method.toLowerCase() : method;
        const timeouts = {
            'getbalance': 10000,
            'getaddress': 10000,
            'dero.getsc': 30000,
            'gettransfers': 30000,
            'transfer': 60000,  // 60 seconds - transfers need wallet approval, can take longer
            'dero.getinfo': 10000,
            'gnomon.getowner': 15000,
            'gnomon.getlastindexheight': 10000,
            'gnomon.getallownersandscids': 30000
        };
        return timeouts[methodKey] || 10000;
    }
    
    // XSWD Improvement: Rate-limited and queued sendRequest
    // Based on: https://tela.derod.org/xswd
    async sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            // Check connection state (TELA best practice)
            if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                const error = new Error('WebSocket not connected. Please reconnect your wallet.');
                console.error('❌ Cannot send request - WebSocket not connected:', method);
                
                // Auto-disconnect state to prevent further attempts
                this.isConnected = false;
                this.isAuthenticated = false;
                this.userDisconnected = true;
                
                // Notify app
                this.emit('disconnected');
                
                reject(error);
                return;
            }
            
            const request = {
                method,
                params,
                resolve,
                reject,
                timestamp: Date.now()
            };
            
            if (method === 'GetBalance' && params && params.scid) {
                // SCID-specific balances should be processed immediately (don't queue)
                this.sendQueuedRequest(request);
            } else {
                // Enqueue all other requests (including wallet balance)
                this.requestQueue.push(request);
                if (!this.isProcessingQueue) {
                    this.processQueue();
                }
            }
        });
    }
    
    // XSWD Improvement: Process request queue with rate limiting
    // Based on TELA XSWD Advanced pattern: https://tela.derod.org/templates/xswd-advanced
    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
            // Check connection before processing (prevent errors)
            if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.warn('⚠️ [XSWD Queue] Connection lost, clearing queue');
                // Clear queue and reject all pending requests
                while (this.requestQueue.length > 0) {
                    const request = this.requestQueue.shift();
                    try {
                        request.reject(new Error('WebSocket connection lost'));
                    } catch (e) {
                        console.error('Error rejecting queued request:', e);
                    }
                }
                this.isProcessingQueue = false;
                return;
            }
            
            const now = Date.now();
            const timeSinceLastCall = now - this.lastCallTime;
            
            // Rate limit: wait if needed (max 10 calls per second - prevents Engram overload)
            // TELA pattern: Respect Engram's rate limits to prevent crashes
            // Reduced interval to 100ms to match Engram Calls tab behavior (which works reliably)
            if (timeSinceLastCall < this.MIN_CALL_INTERVAL) {
                const waitTime = this.MIN_CALL_INTERVAL - timeSinceLastCall;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            const request = this.requestQueue.shift();
            this.activeRequests++;
            this.lastCallTime = Date.now();

            // Send actual request
            this.sendQueuedRequest(request).catch(error => {
                // Check for critical errors that indicate Engram crash
                const errorMsg = error?.message || '';
                if (errorMsg.includes('not connected') || 
                    errorMsg.includes('closed') ||
                    errorMsg.includes('timeout')) {
                    console.error('⚠️ Critical error in request - auto-disconnecting:', errorMsg);
                    this.userDisconnected = true;
                    this.isConnected = false;
                    this.isAuthenticated = false;
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close(1000, 'Critical error');
                    }
                    this.emit('disconnected');
                }
            }).finally(() => {
                this.activeRequests--;
                // Continue processing queue
                setTimeout(() => this.processQueue(), 0);
            });
        }

        this.isProcessingQueue = false;
    }
    
    // XSWD Improvement: Send individual queued request
    async sendQueuedRequest(request) {
        const { method, params, resolve, reject } = request;
        
        return new Promise((innerResolve) => {
            // Generate unique request ID (TELA pattern: incremental or unique)
            const id = (this.callId++).toString();
            
            // Build RPC request (TELA format: jsonrpc, id, method, optional params)
            const rpcRequest = {
                jsonrpc: '2.0',
                id: id,
                method: method
            };
            
            // Add params only if provided (TELA pattern)
            if (Object.keys(params).length > 0) {
                rpcRequest.params = params;
            }
            
            // Log transfer requests for debugging
            if ((method === 'transfer' || method === 'Transfer') && params.transfers) {
                console.log('📤 [XSWD Transfer] Sending transfer request:', {
                    method: method,
                    scid: params.scid,
                    entrypoint: params.sc_rpc?.[0]?.value,
                    transfers: params.transfers,
                    fullParams: params
                });
            }
            
            // Get method-specific timeout
            const timeout = this.getTimeoutForMethod(method);
            
            // Store pending request for response matching (TELA pattern)
            const timeoutId = setTimeout(() => {
                if (this.globalResolutions[id]) {
                    delete this.globalResolutions[id];
                    const timeoutError = new Error(`Timeout: ${method} (${timeout}ms)`);
                    
                    // Enhanced timeout logging
                    console.error(`⏱️ [XSWD Timeout] Method: ${method} timed out after ${timeout}ms`, {
                        method: method,
                        params: params,
                        timeout: timeout,
                        requestId: id
                    });
                    
                    // Log to app debug if available
                    if (window.app && typeof window.app.logDebug === 'function') {
                        window.app.logDebug(`⏱️ XSWD Timeout [${method}]: ${timeout}ms`, 'error');
                    }
                    
                    reject(timeoutError);
                    innerResolve();
                }
            }, timeout);
            
            // Store resolver with timeout cleanup
            this.globalResolutions[id] = [
                (response) => {
                    clearTimeout(timeoutId);
                    // Handle RPC error response (TELA pattern)
                    if (response.error) {
                        // Enhanced error logging - show full Engram error details
                        const errorCode = response.error.code;
                        const errorMsg = response.error.message || 'RPC error';
                        const errorData = response.error.data || '';
                        
                        console.error(`❌ [XSWD Error] Method: ${method}, Code: ${errorCode}, Message: ${errorMsg}`, {
                            method: method,
                            params: params,
                            errorCode: errorCode,
                            errorMessage: errorMsg,
                            errorData: errorData,
                            fullResponse: response
                        });
                        
                        // Log to app debug if available
                        if (window.app && typeof window.app.logDebug === 'function') {
                            window.app.logDebug(`❌ XSWD Error [${method}]: ${errorCode} - ${errorMsg}`, 'error');
                        }
                        
                        reject(new Error(errorMsg));
                    } else {
                        resolve(response.result || response);
                    }
                    innerResolve();
                },
                0
            ];
            
            // Store request for debugging
            if (method === 'transfer' || method === 'Transfer') {
                console.log('📤 [XSWD Transfer] Sending transfer request:', {
                    method: method,
                    id: id,
                    scid: params.scid,
                    entrypoint: params.sc_rpc?.[0]?.value,
                    transfers: params.transfers,
                    amount: params.amount,
                    fullParams: JSON.stringify(params, null, 2)
                });
            } else {
                console.log('📤 Sending RPC request:', method, 'id:', id, 'params:', JSON.stringify(params).substring(0, 200));
            }
            if (window.app && typeof window.app.logDebug === 'function') {
                window.app.logDebug(`➡️ ${method} [id=${id}] params=${JSON.stringify(params)}`);
            }
            
            // Send request with error handling
            try {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    const error = new Error('WebSocket not connected');
                    console.error('❌ [XSWD Send Error] Cannot send - WebSocket not connected:', {
                        method: method,
                        wsState: this.ws?.readyState,
                        isConnected: this.isConnected,
                        isAuthenticated: this.isAuthenticated
                    });
                    throw error;
                }
                
                // Check queue size to prevent Engram overload (TELA pattern)
                if (this.requestQueue.length > 10) {
                    console.warn('⚠️ [XSWD Queue Warning] Request queue is large:', this.requestQueue.length, 'requests pending');
                }
                
                this.ws.send(JSON.stringify(rpcRequest));
            } catch (sendError) {
                console.error('❌ [XSWD Send Error] Failed to send request:', {
                    method: method,
                    params: params,
                    error: sendError,
                    wsState: this.ws?.readyState,
                    queueLength: this.requestQueue.length
                });
                
                // Log to app debug if available
                if (window.app && typeof window.app.logDebug === 'function') {
                    window.app.logDebug(`❌ XSWD Send Error [${method}]: ${sendError.message}`, 'error');
                }
                
                // Auto-disconnect on send failure
                this.userDisconnected = true;
                this.isConnected = false;
                this.isAuthenticated = false;
                if (this.ws) {
                    try {
                        this.ws.close(1000, 'Send error');
                    } catch (e) {
                        console.error('Error closing WebSocket:', e);
                    }
                }
                this.emit('disconnected');
                reject(new Error(`Failed to send request - ${sendError.message}`));
            }
        });
    }

    // Helper method for reading smart contract state (view-only)
    // Advanced format handling moved to appfeat8.js
    async getSC(scid, entrypointOrCode, sc_rpcOrVariables) {
        try {
            // Handle different call patterns:
            // getSC(scid) - basic call
            // getSC(scid, entrypoint) - entrypoint call (skipped)
            // getSC(scid, false, true) - code=false, variables=true
            // getSC(scid, entrypoint, sc_rpc) - entrypoint with params
            
            let code = false;
            let variables = true;
            let entrypoint = null;
            let sc_rpc = [];
            
            if (entrypointOrCode !== undefined) {
                if (typeof entrypointOrCode === 'string' && entrypointOrCode.length > 0) {
                    // It's an entrypoint string
                    entrypoint = entrypointOrCode;
                    sc_rpc = Array.isArray(sc_rpcOrVariables) ? sc_rpcOrVariables : [];
                } else if (typeof entrypointOrCode === 'boolean') {
                    // It's a code parameter (boolean)
                    code = entrypointOrCode;
                    variables = typeof sc_rpcOrVariables === 'boolean' ? sc_rpcOrVariables : true;
                }
            }
            
            if (entrypoint) {
                console.warn(`Skipping entrypoint "${entrypoint}" on ${scid} to avoid wallet permission prompt.`);
                return { error: 'entrypoint_requires_permission', scid, entrypoint };
            }
            
            const params = { scid: scid, code: code, variables: variables };
            const result = await this.sendRequest('DERO.GetSC', params);
            return result;
        } catch (error) {
            console.error('Failed to get SC state:', error);
            return { error: error.message };
        }
    }
    
    disconnect() {
        console.log('🔌 [XSWD] Disconnecting WebSocket...');
        
        // Use setTimeout to prevent blocking
        setTimeout(() => {
            try {
                // XSWD Improvement: Mark as user-initiated disconnect
                this.userDisconnected = true;
                this.isConnected = false;
                this.isAuthenticated = false;
                
                // Clear reconnect timer
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                
                // Clear any pending requests
                this.requestQueue = [];
                this.activeRequests = 0;
                this.isProcessingQueue = false;
                
                // Reject all pending promises
                for (const id in this.globalResolutions) {
                    if (this.globalResolutions[id]) {
                        try {
                            const resolver = this.globalResolutions[id][0];
                            delete this.globalResolutions[id];
                            resolver({ error: { code: -32000, message: 'User disconnected' } });
                        } catch (e) {
                            console.error('Error rejecting pending promise on disconnect:', e);
                        }
                    }
                }
                
                // Close WebSocket if open
                if (this.ws) {
                    try {
                        if (this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
                            this.ws.close(1000, 'User disconnected');
                        }
                    } catch (closeError) {
                        console.error('Error closing WebSocket on disconnect:', closeError);
                    }
                }
                
                // Notify app (wrapped in try-catch)
                try {
                    this.emit('disconnected');
                } catch (emitError) {
                    console.error('Error emitting disconnected event:', emitError);
                }
                
                console.log('✅ [XSWD] WebSocket disconnected');
            } catch (disconnectError) {
                console.error('❌ [XSWD] Error during disconnect:', disconnectError);
                // Don't re-throw - we're in disconnect handler
            }
        }, 0);
    }

    // Utility: Extract value from DERO response (handles all response formats)
    extractValue(result) {
        if (!result) return null;
        
        // Handle result.result format (from getSC responses)
        const data = result.result || result;
        
        if (data.stringvalues && data.stringvalues.length > 0) {
            return data.stringvalues[0];
        }
        if (data.values && data.values.length > 0) {
            return data.values[0];
        }
        if (data.stringvalue) {
            return data.stringvalue;
        }
        if (typeof data === 'string' && data.length > 0) {
            return data;
        }
        
        return null;
    }

    // Subscription management
    subscribeToAddress(address) {
        if (!this.subscriptions.has(`address:${address}`)) {
            this.subscriptions.add(`address:${address}`);
            console.log(`Subscribed to address: ${address}`);
        }
    }

    unsubscribeFromAddress(address) {
        if (this.subscriptions.has(`address:${address}`)) {
            this.subscriptions.delete(`address:${address}`);
            console.log(`Unsubscribed from address: ${address}`);
        }
    }

    // Event handling
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
        // Return handler for easy cleanup
        return handler;
    }

    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    // Utility methods
    isConnected() {
        return this.isConnected;
    }
}

/**
 * UI Fixes for ORED-asset-manager
 * Prevents glitching and flashing in NFT/NFA display
 */

// ========================================
// Utility Functions (moved from appfeat2.js)
// ========================================

// Asset identifier parsing utilities
if (typeof DeroNFTApp !== 'undefined') {
    // Split asset identifier into SCID and tokenId
    DeroNFTApp.prototype.splitAssetIdentifier = function(assetId) {
        if (!assetId || typeof assetId !== 'string') {
            return { scid: '', tokenId: '' };
        }
        const parts = assetId.split('_');
        if (parts.length === 1) {
            return { scid: parts[0], tokenId: '' };
        }
        return { scid: parts[0], tokenId: parts.slice(1).join('_') };
    };

    // Check if an order matches a specific asset (SCID and tokenId)
    DeroNFTApp.prototype.orderMatchesAsset = function(order, scid, tokenId) {
        if (!order || !scid) return false;
        const orderScid = (order.scid || '').toLowerCase();
        const targetScid = (scid || '').toLowerCase();
        if (orderScid !== targetScid) return false;

        const orderToken = order.tokenId !== undefined && order.tokenId !== null ? String(order.tokenId) : '';
        const targetToken = tokenId !== undefined && tokenId !== null ? String(tokenId) : '';

        if (orderToken && targetToken) {
            return orderToken === targetToken;
        }
        return !orderToken || !targetToken;
    };
}

// Export classes for use in other modules
// Make sure these are set immediately and available globally
if (typeof window !== 'undefined') {
    window.DeroWallet = DeroWallet;
    window.WebSocketManager = WebSocketManager;
    
    // Verify exports immediately
    if (typeof window.DeroWallet !== 'undefined') {
        console.log('✅ DeroWallet exported successfully');
    } else {
        console.error('❌ DeroWallet export failed');
    }
    
    if (typeof window.WebSocketManager !== 'undefined') {
        console.log('✅ WebSocketManager exported successfully');
    } else {
        console.error('❌ WebSocketManager export failed');
    }
} else {
    console.error('❌ window object not available - cannot export DeroWallet');
}

