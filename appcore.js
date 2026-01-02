/**
 * ORED-asset-manager - Asset Manager for DERO
 * Core Application Logic - Wallet & Connection Management
 */

/**
 * XSWD Improvement: TTL-based Cache Manager
 * Based on: https://tela.derod.org/xswd
 */
class CacheManager {
    constructor() {
        this.caches = {
            networkInfo: { ttl: 15000 },      // 15 seconds
            balance: { ttl: 30000 },         // 30 seconds
            transfers: { ttl: 60000 },       // 60 seconds
            ownership: { ttl: 300000 },      // 5 minutes (ownership rarely changes)
            contractState: { ttl: 60000 }    // 60 seconds
        };
        this.data = new Map();
    }

    get(key, cacheType = 'default') {
        const entry = this.data.get(key);
        if (!entry) return null;
        
        const ttl = this.caches[cacheType]?.ttl || 30000;
        const age = Date.now() - entry.timestamp;
        
        if (age > ttl) {
            this.data.delete(key);
            return null; // Expired
        }
        
        return entry.value;
    }

    set(key, value, cacheType = 'default') {
        this.data.set(key, {
            value,
            timestamp: Date.now(),
            type: cacheType
        });
    }

    invalidate(pattern) {
        // Invalidate all keys matching pattern
        for (const key of this.data.keys()) {
            if (key.includes(pattern)) {
                this.data.delete(key);
            }
        }
    }
    
    clear() {
        this.data.clear();
    }
}

class DeroNFTApp {
    constructor() {
        this.currentAddress = null;
        this.assets = [];
        this.collections = [];
        this.ws = null;
        this.isConnected = false;
        this.connecting = false; // TELATOMIC-style connection flag
        this.deroWallet = null;
        this.currentTab = 'view'; // Track current active tab
        this.balanceLoading = false;
        this.walletBalanceKnown = false;
        
        // Cache for balance and assets to prevent unnecessary calls
        this.balanceCache = { value: 0, timestamp: 0 };
        this.assetsCache = { value: { nfts: [], nfas: [], orders: [] }, timestamp: 0 };
        this.transfersCache = { value: null, timestamp: 0 }; // Cache transfers data to avoid repeated GetTransfers
        this.loadingTransfers = false; // Flag to prevent multiple simultaneous GetTransfers requests
        this.cacheTimeout = 30000; // 30 seconds cache timeout
        this.transferAssetCache = { assets: [], timestamp: 0 };
        this.initialDataLoaded = false;
        this.loaderTimers = new Map();
        this.activeDropdownLoaders = new Map();
        this.debugLogs = [];
        this.debugLogsVisible = false;
        
        // Persistent storage for manually added assets
        // loadSavedAssets is defined in appfeat4.js, so initialize as empty and load later
        this.savedAssetsKey = 'ored_saved_assets';
        this.savedAssets = []; // Will be loaded when appfeat4.js loads
        
        // Persistent storage for saved tokens (separate from assets)
        // loadSavedTokens is defined in appfeat7.js, so we'll initialize it lazily
        this.savedTokensKey = 'ored_saved_tokens';
        this.savedTokens = []; // Will be loaded when appfeat7.js loads
        
        // Cache for G45/G45-C contract lookups
        this.g45Cache = new Map();
        this.loadingTemplates = {};
        if (typeof document !== 'undefined') {
            const loadingSearchEl = document.getElementById('loadingSearch');
            if (loadingSearchEl) {
                this.loadingTemplates.loadingSearch = loadingSearchEl.innerHTML;
            }
        }
        
        // Default marketplace SCID for G45 NFTs
        this.defaultG45MarketScid = '834fa60e087304de85ef5766a3b6a8bcdc5d3c21480d8adf4b2bdc64d117e580';

        // Cache entrypoints that the user has denied permission for
        this.permissionDenyCache = new Set();

        // Marketplace configuration (SCIDs for trading contracts)
        this.marketConfig = this.loadMarketplaceConfig();
        
        // FORCE UPDATE: Always use the new marketplace SCIDs (remove old ones)
        const NEW_TOKEN_MARKETPLACE_SCID = '890fa1ad517eeaf71035a3e69a4e2b4ca085efb82172e39e4f64990d81d2a7d5';
        const NEW_G45_MARKETPLACE_SCID = 'e25c50680feb0b89eb6b640100fd92b49698c0e0c62681f0c3c5ee899d096aea';
        const OLD_TOKEN_MARKETPLACE_SCID = '96f317d4e30e6329b6216fc5be5c3904429f79ff5b202405f8c382c950857b98';
        
        let configChanged = false;
        
        // Force update token marketplace SCID to new one
        if (!this.marketConfig.tokenMarketplaceScid || 
            this.marketConfig.tokenMarketplaceScid === OLD_TOKEN_MARKETPLACE_SCID ||
            this.marketConfig.tokenMarketplaceScid !== NEW_TOKEN_MARKETPLACE_SCID) {
            this.marketConfig.tokenMarketplaceScid = NEW_TOKEN_MARKETPLACE_SCID;
            configChanged = true;
        }
        
        // Force update G45 marketplace SCID to new one
        if (!this.marketConfig.g45MarketplaceScid || 
            this.marketConfig.g45MarketplaceScid !== NEW_G45_MARKETPLACE_SCID) {
            this.marketConfig.g45MarketplaceScid = NEW_G45_MARKETPLACE_SCID;
            configChanged = true;
        }
        
        // Save if changed
        if (configChanged) {
            this.saveMarketplaceConfig();
            console.log('✅ [Marketplace Config] Updated to use new marketplace SCIDs');
        }
        
        this.initializeDebugLogger();
        // XSWD Improvement: TTL-based cache manager
        this.cacheManager = new CacheManager();
        
        // Don't call init() here - it will be called from appfeat1.js/appfeat2.js after prototype methods are added

        if (typeof window !== 'undefined' && !window.__oredLoaderSafetyHook) {
            window.addEventListener('unhandledrejection', (event) => {
                console.error('Unhandled promise rejection:', event.reason);
                try {
                    // Check if it's an XSWD/WebSocket error - auto-disconnect
                    const errorMsg = event.reason?.message || String(event.reason || '');
                    if (errorMsg.includes('WebSocket') || 
                        errorMsg.includes('not connected') ||
                        errorMsg.includes('XSWD') ||
                        errorMsg.includes('Engram')) {
                        console.error('⚠️ XSWD/WebSocket error detected - auto-disconnecting');
                        if (window.app && window.app.deroWallet && window.app.deroWallet.ws) {
                            try {
                                window.app.deroWallet.ws.userDisconnected = true;
                                window.app.deroWallet.ws.disconnect();
                            } catch (e) {
                                console.error('Error disconnecting:', e);
                            }
                        }
                    }
                    
                    if (window.app && typeof window.app.hideAllLoaders === 'function') {
                        window.app.hideAllLoaders();
                    }
                } catch (e) {
                    console.error('Error in hideAllLoaders:', e);
                }
                try {
                    if (window.app && typeof window.app.showNotification === 'function') {
                        window.app.showNotification('An error occurred. Please try again.', 'error');
                    }
                } catch (e) {
                    console.error('Error showing notification:', e);
                }
                // Prevent default to stop error propagation
                event.preventDefault();
                // Return true to indicate we handled it
                return true;
            });
            window.addEventListener('error', (event) => {
                console.error('Unhandled error:', event.error, event.message, event.filename, event.lineno);
                try {
                    // Check if it's an XSWD/WebSocket error - auto-disconnect
                    const errorMsg = event.message || String(event.error || '');
                    if (errorMsg.includes('WebSocket') || 
                        errorMsg.includes('not connected') ||
                        errorMsg.includes('XSWD') ||
                        errorMsg.includes('Engram')) {
                        console.error('⚠️ XSWD/WebSocket error detected - auto-disconnecting');
                        if (window.app && window.app.deroWallet && window.app.deroWallet.ws) {
                            try {
                                window.app.deroWallet.ws.userDisconnected = true;
                                window.app.deroWallet.ws.disconnect();
                            } catch (e) {
                                console.error('Error disconnecting:', e);
                            }
                        }
                    }
                    
                    if (window.app && typeof window.app.hideAllLoaders === 'function') {
                        window.app.hideAllLoaders();
                    }
                } catch (e) {
                    console.error('Error in hideAllLoaders:', e);
                }
                try {
                    if (window.app && typeof window.app.showNotification === 'function') {
                        window.app.showNotification('An error occurred. Please refresh the page.', 'error');
                    }
                } catch (e) {
                    console.error('Error showing notification:', e);
                }
                // Prevent default to stop error propagation
                event.preventDefault();
                // Return true to indicate we handled it
                return true;
            });
            window.__oredLoaderSafetyHook = true;
        }
    }

    // Asset management functions moved to appfeat4.js:
    // - loadSavedAssets()
    // - saveAssets()
    // - primeCachedAssetsFromSaved()
    // - loadAssets()

    // loadSavedTokens() and saveTokens() moved to appfeat7.js

    // Marketplace configuration functions moved to appfeat6.js:
    // - loadMarketplaceConfig()
    // - saveMarketplaceConfig()
    // - ensureG45MarketplaceScid()
    // - getNfaMarketplaceScid()
    // - setNfaMarketplaceScid()

    // Token Marketplace SCID management functions moved to appfeat7.js:
    // - ensureTokenMarketplaceScid()
    // - getTokenMarketplaceScid()
    // - setTokenMarketplaceScid()

    // Utility functions moved to appfeat1.js:
    // - deroToAtomic()
    // - atomicToDero()

    initializeDebugLogger() {
        this.debugLogs = [];
        this.debugLogsVisible = false;
        this.debugLogLimit = 200;
    }

    logDebug(entry) {
        if (!this.debugLogs) {
            this.initializeDebugLogger();
        }
        const timestamp = new Date().toISOString();
        const message = typeof entry === 'string' ? entry : JSON.stringify(entry, null, 2);
        this.debugLogs.push(`[${timestamp}] ${message}`);
        if (this.debugLogs.length > this.debugLogLimit) {
            this.debugLogs.shift();
        }
        this.renderDebugLogs();
    }

    renderDebugLogs() {
        if (!this.debugLogsVisible) {
            return;
        }
        const debugOutput = document.getElementById('debugLogOutput');
        if (!debugOutput) {
            return;
        }
        debugOutput.textContent = this.debugLogs.length > 0
            ? this.debugLogs.join('\n\n')
            : 'No debug entries yet.';
    }

    setupDebugControls() {
        if (this.debugControlsReady) return;
        this.debugControlsReady = true;
        // Debug tab removed - replaced with Engram Calls tab
        // These elements no longer exist, so skip initialization
        const toggleBtn = document.getElementById('toggleDebugLogs');
        const copyBtn = document.getElementById('copyDebugLogs');
        const clearBtn = document.getElementById('clearDebugLogs');
        const debugOutput = document.getElementById('debugLogOutput');
        if (!toggleBtn || !copyBtn || !clearBtn || !debugOutput) {
            // Debug tab doesn't exist - skip setup
            return;
        }

        toggleBtn.addEventListener('click', () => {
            this.debugLogsVisible = !this.debugLogsVisible;
            debugOutput.dataset.visible = this.debugLogsVisible;
            toggleBtn.innerHTML = this.debugLogsVisible
                ? '<i class="fas fa-eye-slash"></i> Hide Logs'
                : '<i class="fas fa-eye"></i> Show Logs';
            debugOutput.textContent = this.debugLogsVisible
                ? (this.debugLogs.length > 0 ? this.debugLogs.join('\n\n') : 'No debug entries yet.')
                : 'Debug logs are hidden. Click "Show Logs" to view.';
        });

        copyBtn.addEventListener('click', async () => {
            if (!navigator.clipboard) {
                this.showError?.('Clipboard API not available');
                return;
            }
            const text = this.debugLogs.join('\n\n') || 'No debug entries yet.';
            try {
                await navigator.clipboard.writeText(text);
                this.showSuccess?.('Debug logs copied to clipboard.');
            } catch (error) {
                console.error('Failed to copy logs:', error);
                this.showError?.('Failed to copy logs to clipboard.');
            }
        });

        clearBtn.addEventListener('click', () => {
            this.debugLogs = [];
            this.renderDebugLogs();
        });
    }

    init() {
        this.setupCoreEventListeners();
        // Setup feature event listeners if available (from appfeat1.js/appfeat2.js)
        // This will be set up after the feature files load, but init() might run in constructor
        // So we'll also call it from initializeApp if needed
        if (this.setupFeatureEventListeners) {
            this.setupFeatureEventListeners();
        }
        // loadCollections is implemented in appfeat1.js - will be available after prototype extension
        if (this.loadCollections) {
            this.loadCollections();
        }
        // Load saved assets from localStorage on initialization
        // This ensures saved assets persist across page refreshes
        if (typeof this.loadAssets === 'function') {
            this.loadAssets(false).catch(error => console.warn('Initial asset cache load failed:', error));
        } else if (typeof this.loadSavedAssets === 'function') {
            // Fallback: if loadAssets not available yet, at least load savedAssets
            try {
                this.savedAssets = this.loadSavedAssets();
                if (this.primeCachedAssetsFromSaved) {
                    this.primeCachedAssetsFromSaved(false);
                }
            } catch (e) {
                console.warn('Failed to load saved assets on init:', e);
            }
        }
        this.initializeDeroIntegration();
        // NO automatic connections - only connect when user clicks "Connect Wallet"
        this.updateConnectionStatus(false);
        this.updateWalletBalance(null);
        this.setupDebugControls();
    }

    setupCoreEventListeners() {
        // Token Trading Tab - Search button
        const searchTokenBtn = document.getElementById('searchTokenBtn');
        const tokenSearchInput = document.getElementById('tokenSearchInput');
        if (searchTokenBtn) {
            searchTokenBtn.addEventListener('click', () => {
                if (tokenSearchInput && this.searchToken) {
                    const scid = tokenSearchInput.value.trim();
                    if (scid) {
                        this.searchToken(scid);
                    } else {
                        this.showError('Please enter a token SCID to search.');
                    }
                }
            });
        }
        if (tokenSearchInput) {
            tokenSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && searchTokenBtn) {
                    searchTokenBtn.click();
                }
            });
        }

        // Token Trading Tab - Create order buttons
        const createTokenBuyOrderBtn = document.getElementById('createTokenBuyOrder');
        const createTokenSellOrderBtn = document.getElementById('createTokenSellOrder');
        if (createTokenBuyOrderBtn && this.createTokenBuyOrder) {
            createTokenBuyOrderBtn.addEventListener('click', () => this.createTokenBuyOrder());
        }
        if (createTokenSellOrderBtn && this.createTokenSellOrder) {
            createTokenSellOrderBtn.addEventListener('click', () => this.createTokenSellOrder());
        }

        // Buy/Sell Tabs - Create order buttons
        const createSellOrderBtn = document.getElementById('createSellOrder');
        const createBuyOrderBtn = document.getElementById('createBuyOrder');
        if (createSellOrderBtn && this.showAssetSelectionModal) {
            createSellOrderBtn.addEventListener('click', () => this.showAssetSelectionModal('sell'));
        }
        if (createBuyOrderBtn && this.showAssetSelectionModal) {
            createBuyOrderBtn.addEventListener('click', () => this.showAssetSelectionModal('buy'));
        }

        // Tab navigation - switchTab is provided by appfeat1.js/appfeat2.js
        const tabButtons = document.querySelectorAll('.tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                if (this.switchTab) {
                    this.switchTab(tabName);
                } else {
                    console.warn('switchTab not available yet. Feature methods may not be loaded.');
                }
            });
        });

        // Wallet connection
        const connectWalletBtn = document.getElementById('connectWallet');
        const disconnectWalletBtn = document.getElementById('disconnectWallet');
        
        if (connectWalletBtn) {
            connectWalletBtn.addEventListener('click', () => {
                if (this.connectWallet) {
                    this.connectWallet();
                } else {
                    console.error('connectWallet method not available');
                }
            });
        }
        
        if (disconnectWalletBtn) {
            disconnectWalletBtn.addEventListener('click', () => {
                if (this.disconnectWallet) {
                    this.disconnectWallet();
                } else {
                    console.error('disconnectWallet method not available');
                }
            });
        }
    }

    async initializeDeroIntegration() {
        try {
            // Initialize Dero Wallet integration
            const DeroWalletClass = typeof DeroWallet !== 'undefined' ? DeroWallet :
                                  typeof window.DeroWallet !== 'undefined' ? window.DeroWallet :
                                  null;
            if (DeroWalletClass) {
                this.deroWallet = new DeroWalletClass();
                await this.deroWallet.initialize();
            }
        } catch (error) {
            console.error('Failed to initialize Dero integration:', error);
        }
    }

    connectWebSocket() {
        try {
            this.ws = new WebSocketManager();
            
            // Set up WebSocket event handlers
            this.ws.on('connected', () => {
                this.isConnected = true;
                if (this.deroWallet) {
                    this.deroWallet.setWebSocket(this.ws);
                }
            });
            
            // Handle address events from WebSocket
            this.ws.on('address', (address) => {
                console.log('📨 Address event received in appcore:', address);
                if (address && !this.currentAddress) {
                    this.currentAddress = address;
                    this.updateWalletDisplay(address);
                    this.updateConnectionStatus(true);
                    document.getElementById('fromAddress').value = address;
                    // Don't load balance/assets here - connectWallet() handles it to avoid duplicate GetBalance calls
                    // The address event is just for UI updates when wallet auto-connects
                }
            });
            
            this.ws.on('disconnected', () => {
                this.isConnected = false;
                this.currentAddress = null;
                this.updateConnectionStatus(false);
                this.updateWalletBalance(null);
                this.updateWalletDisplay('');
                this.showNotification('Wallet disconnected', 'info');
            });
            
            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.isConnected = false;
            });
            
            // Handle balance updates
            this.ws.on('balanceUpdate', (data) => {
                if (data.address === this.currentAddress) {
                    const balanceDERO = data.balance / 100000;
                    this.updateWalletBalance(balanceDERO);
                    this.balanceCache = { value: balanceDERO, timestamp: Date.now() };
                    this.showNotification(`Balance updated: ${balanceDERO.toFixed(4)} DERO`, 'info');
                }
            });
            
            // Handle new transactions
            this.ws.on('newTransaction', (data) => {
                if (data.from === this.currentAddress || data.to === this.currentAddress) {
                    this.showNotification(`New transaction: ${data.txid}`, 'info');
                    // Refresh balance and assets after transaction
                    this.loadWalletStats(true); // Force refresh
                    this.loadAssets(); // Refresh assets when transaction occurs
                }
            });
            
            // Actually connect the WebSocket after all handlers are set up
            this.ws.connect();
            
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.isConnected = false;
            this.showNotification('WebSocket initialization failed - using offline mode', 'error');
        }
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        const connectBtn = document.getElementById('connectWallet');
        const disconnectBtn = document.getElementById('disconnectWallet');
        
        if (statusElement) {
            if (connected) {
                statusElement.textContent = '🟢 Connected';
                statusElement.className = 'connection-status connected';
            } else {
                statusElement.textContent = '🔴 Disconnected';
                statusElement.className = 'connection-status disconnected';
            }
        }
        
        // Update button visibility
        if (connectBtn && disconnectBtn) {
            if (connected) {
                connectBtn.style.display = 'none';
                disconnectBtn.style.display = 'inline-block';
            } else {
                connectBtn.style.display = 'inline-block';
                disconnectBtn.style.display = 'none';
            }
        }
    }

    disconnectWallet() {
        this.currentAddress = null;
        this.updateWalletDisplay('');
        this.updateConnectionStatus(false);
        this.updateWalletBalance(null);
        
        // Clear connection state
        localStorage.removeItem('ored_connection_state');
        
        // Clear form fields
        document.getElementById('fromAddress').value = '';
        
        this.showSuccess('Wallet disconnected successfully!');
    }

    subscribeToAddress(address) {
        if (this.ws && this.isConnected) {
            this.ws.subscribeToAddress(address);
        }
    }

    async connectWallet() {
        try {
            // TELATOMIC-style simple connection check
            if (this.currentAddress) {
                this.showNotification('Wallet already connected: ' + this.currentAddress.substring(0, 10) + '...', 'info');
                return;
            }
            
            // Check if WebSocket is already connected and has address
            if (this.ws && this.ws.isConnected && this.ws.isAuthenticated) {
                try {
                    const accounts = await this.deroWallet.requestAccounts();
                    if (accounts && accounts.length > 0) {
                        this.currentAddress = accounts[0];
                        this.updateWalletDisplay(this.currentAddress);
                        this.updateConnectionStatus(true);
                        this.showNotification('Wallet connected: ' + this.currentAddress.substring(0, 10) + '...', 'success');
                        return;
                    }
                } catch (error) {
                }
            }
            
            // Check if we already have an address from a previous connection
            if (this.currentAddress) {
                this.updateWalletDisplay(this.currentAddress);
                this.updateConnectionStatus(true);
                this.showNotification('Wallet already connected: ' + this.currentAddress.substring(0, 10) + '...', 'info');
                return;
            }
            
            // TELATOMIC-style connection logic
            if (this.connecting) {
                return;
            }
            
            this.connecting = true;
            
            // Initialize Dero wallet integration
            if (!this.deroWallet) {
                // Try multiple ways to get DeroWallet
                const DeroWalletClass = typeof DeroWallet !== 'undefined' ? DeroWallet :
                                      typeof window.DeroWallet !== 'undefined' ? window.DeroWallet :
                                      null;
                
                if (!DeroWalletClass) {
                    console.error('DeroWallet not found. Available globals:', {
                        DeroWallet: typeof DeroWallet,
                        windowDeroWallet: typeof window.DeroWallet,
                        windowKeys: Object.keys(window).filter(k => k.includes('Dero') || k.includes('Wallet'))
                    });
                    throw new Error('DeroWallet class not found. Make sure combined.js is loaded before appcore.js');
                }
                
                this.deroWallet = new DeroWalletClass();
                await this.deroWallet.initialize();
            }

            
            if (!this.deroWallet.provider) {
                this.showDetailedError('No DERO wallet detected. Please:', [
                    '1. Make sure Engram desktop app is running',
                    '2. Enable XSWD in Engram settings (Settings > XSWD)',
                    '3. Make sure Engram is unlocked and connected to network',
                    '4. Check that XSWD port 44326 is accessible',
                    'Note: This site connects to Engram desktop app via XSWD WebSocket'
                ]);
                return;
            }

            // For XSWD mode with Engram desktop app, we don't need browser extension detection
            // The WebSocket connection will handle everything

            // Connect WebSocket first (XSWD method - WebSocket for all operations)
            this.connectWebSocket();
            
            // Wait for WebSocket to connect and authenticate (event-driven, not polling)
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('WebSocket connection timeout - please ensure Engram is running with XSWD enabled'));
                }, 10000);
                
                // If already connected and authenticated, resolve immediately
                if (this.ws && this.ws.isConnected && this.ws.isAuthenticated) {
                    clearTimeout(timeout);
                    resolve();
                    return;
                }
                
                // Wait for 'connected' event from WebSocketManager (event-driven approach)
                const onConnected = () => {
                    if (this.ws && this.ws.isConnected && this.ws.isAuthenticated) {
                        if (this.ws.off) {
                            this.ws.off('connected', onConnected);
                            this.ws.off('error', onError);
                        }
                        clearTimeout(timeout);
                        resolve();
                    }
                };
                
                const onError = (error) => {
                    if (this.ws && this.ws.off) {
                        this.ws.off('connected', onConnected);
                        this.ws.off('error', onError);
                    }
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection failed: ' + (error.message || error)));
                };
                
                this.ws.on('connected', onConnected);
                this.ws.on('error', onError);
            });
            
            // Set WebSocket on DeroWallet if not already set
            if (!this.deroWallet.ws) {
                this.deroWallet.setWebSocket(this.ws);
            }
            
            // Request real wallet connection via WebSocket (will wait for address event)
            const accounts = await this.deroWallet.requestAccounts();
            
            if (accounts && accounts.length > 0) {
                const address = accounts[0];
                
                // Validate wallet address
                if (!this.isValidAddress(address)) {
                    this.showError('Invalid wallet address. Please connect a real DERO wallet (Engram or CLI).');
                    return;
                }
                
                // TELATOMIC-style simple connection handling
                this.connecting = false;
                this.currentAddress = address;
                document.getElementById('fromAddress').value = address;
                
                // Update UI to show connected wallet (TELATOMIC style)
                this.updateWalletDisplay(address);
                this.updateConnectionStatus(true);
                
                // Load user's balance and assets once on connection (prevents duplicate prompts by gating via initialDataLoaded)
                await this.loadBalance();
                if (this.loadAssets) {
                    await this.loadAssets();
                }
                this.initialDataLoaded = true;
                
                this.showSuccess('Wallet connected successfully via WebSocket!');
                
                // Subscribe to WebSocket events for this address
                this.subscribeToAddress(address);
                
                // Store connection state in localStorage for persistence
                this.saveConnectionState();
                
            } else {
                this.connecting = false;
                throw new Error('No wallet accounts available. Please check your Engram wallet connection.');
            }
            
        } catch (error) {
            this.connecting = false; // TELATOMIC-style error handling
            this.showError(`Failed to connect wallet: ${error.message}`);
            console.error('Wallet connection error:', error);
            
            // Show helpful error message for common issues
            if (error.message.includes('No DERO wallet')) {
                this.showError('Engram wallet not detected. Please ensure the Engram browser extension is installed and enabled, or connect via XSWD.');
            } else if (error.message.includes('User rejected')) {
                this.showError('Wallet connection was rejected. Please try again and approve the connection in Engram.');
            }
        }
    }

    saveConnectionState() {
        try {
            const connectionState = {
                address: this.currentAddress,
                isConnected: this.isConnected,
                currentTab: this.currentTab,
                timestamp: Date.now()
            };
            localStorage.setItem('ored_connection_state', JSON.stringify(connectionState));
        } catch (error) {
            console.error('Failed to save connection state:', error);
        }
    }

    async loadBalance() {
        if (!this.currentAddress || !this.deroWallet) {
            console.log('loadBalance: No address or wallet', { address: this.currentAddress, wallet: !!this.deroWallet });
            return;
        }
        
        try {
            console.log('Loading balance for address:', this.currentAddress);
            const balanceAtomic = await this.deroWallet.getBalance(this.currentAddress);
            console.log('Balance (atomic units):', balanceAtomic);
            // Convert atomic units to DERO (1 DERO = 100000 atomic units)
            const balanceDERO = balanceAtomic / 100000;
            console.log('Balance (DERO):', balanceDERO);
            this.updateWalletBalance(balanceDERO);
            this.balanceCache = { value: balanceDERO, timestamp: Date.now() };
        } catch (error) {
            console.error('Failed to load balance:', error);
            this.updateWalletBalance(null);
        }
    }

    async loadWalletStats(forceRefresh = false) {
        if (!this.currentAddress) return;
        if (this.balanceLoading) return;
        this.balanceLoading = true;

        // Check cache first
        const now = Date.now();
        if (!forceRefresh && this.balanceCache.timestamp > 0 && (now - this.balanceCache.timestamp) < this.cacheTimeout) {
            this.updateWalletBalance(this.balanceCache.value);
            this.balanceLoading = false;
            return;
        }

        try {
            // Load balance via WebSocket instead of API
            const balanceAtomic = await this.deroWallet.getBalance(this.currentAddress);
            // Convert atomic units to DERO units (1 DERO = 100000 atomic units)
            const balanceDERO = balanceAtomic / 100000;
            
            // Update cache
            this.balanceCache = { value: balanceDERO, timestamp: now };
            
            // Update balance display
            this.updateWalletBalance(balanceDERO);
            
        } catch (error) {
            console.error('Failed to load wallet stats:', error);
            this.updateWalletBalance(null);
        } finally {
            this.balanceLoading = false;
        }
    }

    async refreshBalanceAfterTrade() {
        if (this.currentAddress) {
            await this.loadWalletStats(true); // Force refresh
        }
    }

    async refreshWalletData() {
        if (!this.currentAddress) {
            this.showError('Please connect a wallet first');
            return;
        }

        // Force refresh of wallet data
        this.balanceCache = { value: 0, timestamp: 0 };
        this.assetsCache = { value: { nfts: [], nfas: [], orders: [] }, timestamp: 0 };
        await this.loadWalletStats(true); // Force refresh
        await this.loadAssets(true); // Force refresh
        
        this.showSuccess('Wallet data refreshed');
    }

    isValidAddress(address) {
        if (!address || typeof address !== 'string') {
            return false;
        }
        const trimmed = address.trim();
        // Accept modern deto addresses (base32, typically 66 chars) or legacy 64-char hex
        if (/^deto1[0-9a-z]{59,120}$/i.test(trimmed)) {
            return true;
        }
        if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
            return true;
        }
        return false;
    }

    // Wallet Display Management
    updateWalletDisplay(address) {
        // Show wallet info section
        const walletInfo = document.getElementById('walletInfo');
        const walletAddress = document.getElementById('walletAddress');
        
        if (walletInfo && walletAddress) {
            walletAddress.textContent = `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
            walletInfo.classList.remove('hidden');
        }
        
        // Update connection status
        this.updateConnectionStatus(true);
    }

    // Balance Management
    updateWalletBalance(balance) {
        const balanceElement = document.getElementById('walletBalance');
        const balanceAmount = document.getElementById('balanceAmount');
        if (!balanceElement || !balanceAmount) {
            return;
        }
        
        if (typeof balance === 'number' && Number.isFinite(balance)) {
            this.walletBalanceKnown = true;
            balanceAmount.textContent = `${balance.toFixed(4)} DERO`;
            balanceAmount.title = 'Wallet balance';
        } else {
            this.walletBalanceKnown = false;
            balanceAmount.textContent = '—.-- DERO';
            balanceAmount.title = 'Awaiting wallet permission to read balance';
        }
        balanceElement.classList.remove('hidden');
    }

    // Utility methods for notifications (core functionality)
    showLoading(elementId) {
        if (!elementId) return;
        const el = document.getElementById(elementId);
        if (!el) return;
        el.classList.remove('hidden');
        // Initialize loaderTimers if not already done
        if (!this.loaderTimers) {
            this.loaderTimers = new Map();
        }
        // Clear any existing timer for this loader
        if (this.loaderTimers.has(elementId)) {
            clearTimeout(this.loaderTimers.get(elementId));
        }
        // Safety: Auto-hide after 45s to prevent permanent white-out
        const timer = setTimeout(() => {
            console.warn(`⚠️ Auto-hiding loader ${elementId} after 45s timeout`);
            this.hideLoading(elementId);
        }, 45000);
        this.loaderTimers.set(elementId, timer);
    }

    hideLoading(elementId) {
        if (!elementId) return;
        const el = document.getElementById(elementId);
        // Clear timer if loaderTimers exists
        if (this.loaderTimers && this.loaderTimers.has(elementId)) {
            clearTimeout(this.loaderTimers.get(elementId));
            this.loaderTimers.delete(elementId);
        }
        // Hide the element
        if (el) {
            el.classList.add('hidden');
        }
    }

    hideAllLoaders() {
        // Hide all known loaders (even if not in timers map)
        const knownLoaders = ['loadingSearch', 'loadingAssets', 'loadingSellOrders', 'loadingBuyOrders'];
        for (const id of knownLoaders) {
            this.hideLoading(id);
        }
        // Also clear any timers
        if (this.loaderTimers) {
            for (const id of Array.from(this.loaderTimers.keys())) {
                this.hideLoading(id);
            }
            this.loaderTimers.clear();
        }
    }

    async withLoading(elementId, action) {
        if (!elementId) {
            // If no elementId, just run the action
            return await action();
        }
        this.showLoading(elementId);
        try {
            return await action();
        } catch (error) {
            // Ensure loader is hidden even on error
            this.hideLoading(elementId);
            throw error;
        } finally {
            // Double-check loader is hidden
            this.hideLoading(elementId);
        }
    }

    // UI utility functions moved to appfeat1.js:
    // - setActionLoading()
    // - getAssetDomKey()

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showDetailedError(title, steps) {
        const notification = document.createElement('div');
        notification.className = 'notification error detailed';
        notification.innerHTML = `
            <div class="error-header">
                <i class="fas fa-exclamation-circle"></i>
                <span>${title}</span>
            </div>
            <div class="error-steps">
                ${steps.map(step => `<div class="error-step">${step}</div>`).join('')}
            </div>
        `;
        const mount = (typeof document !== 'undefined' && (document.body || document.documentElement)) || null;
        if (mount) {
            (document.body || document.documentElement).appendChild(notification);
        } else {
            try { alert(`${title}\n\n${steps.join('\n')}`); } catch (_) {}
            return;
        }
        
        setTimeout(() => {
            notification.remove();
        }, 10000);
    }

    showMessage(message, type) {
        const resultDiv = document.getElementById('sendResult');
        if (resultDiv) {
            resultDiv.textContent = message;
            resultDiv.className = `result-message ${type}`;
            resultDiv.classList.remove('hidden');
            
            setTimeout(() => {
                resultDiv.classList.add('hidden');
            }, 5000);
            return;
        }
        this.showNotification(message, type);
    }

    showNotification(message, typeOrOpts = 'info', maybeDuration) {
        // Simple, safe notification - no crashes
        try {
            // Validate inputs
            if (!message) {
                return null;
            }

            // Check DOM availability
            if (typeof document === 'undefined') {
                console.log(`[${typeof typeOrOpts === 'object' ? (typeOrOpts.type || 'info') : (typeOrOpts || 'info')}] ${message}`);
                return null;
            }

            // Wait for DOM to be ready if needed
            if (!document.body && !document.documentElement) {
                console.log(`[${typeof typeOrOpts === 'object' ? (typeOrOpts.type || 'info') : (typeOrOpts || 'info')}] ${message}`);
                return null;
            }

            // Parse options safely
            let opts;
            try {
                opts = (typeof typeOrOpts === 'object')
                    ? { type: 'info', durationMs: 3000, closable: false, ...typeOrOpts }
                    : { type: String(typeOrOpts || 'info'), durationMs: (typeof maybeDuration === 'number' ? maybeDuration : 3000), closable: false };
            } catch (e) {
                opts = { type: 'info', durationMs: 3000, closable: false };
            }
            
            // Create notification element
            let notification;
            try {
                notification = document.createElement('div');
                notification.className = `notification notification-${opts.type || 'info'}`;
                
                const content = document.createElement('div');
                content.className = 'notification-content';
                content.textContent = String(message || '');
                notification.appendChild(content);
                
                if (opts.closable) {
                    const closeBtn = document.createElement('button');
                    closeBtn.className = 'notification-close';
                    closeBtn.innerHTML = '&times;';
                    closeBtn.onclick = () => {
                        try {
                            if (notification && notification.parentNode) {
                                notification.parentNode.removeChild(notification);
                            }
                        } catch (e) {
                            console.error('Error removing notification:', e);
                        }
                    };
                    notification.appendChild(closeBtn);
                }
            } catch (e) {
                console.error('Error creating notification element:', e);
                console.log(`[${opts.type || 'info'}] ${message}`);
                return null;
            }
            
            // Append to DOM
            try {
                const mount = document.body || document.documentElement;
                if (mount) {
                    mount.appendChild(notification);
                } else {
                    console.log(`[${opts.type || 'info'}] ${message}`);
                    return null;
                }
            } catch (e) {
                console.error('Error appending notification to DOM:', e);
                console.log(`[${opts.type || 'info'}] ${message}`);
                return null;
            }
            
            // Auto-remove after duration
            try {
                const ttl = typeof opts.durationMs === 'number' && opts.durationMs > 0 ? opts.durationMs : 3000;
                setTimeout(() => {
                    try {
                        if (notification && notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    } catch (e) {
                        console.error('Error auto-removing notification:', e);
                    }
                }, ttl);
            } catch (e) {
                console.error('Error setting notification timeout:', e);
            }
            
            return notification;
        } catch (error) {
            // Ultimate fallback - just log, never crash
            console.error('showNotification error:', error);
            console.log(`[notification] ${message || 'Unknown message'}`);
            return null;
        }
    }

    async pollTxConfirmation(txid, { intervalMs = 4000, timeoutMs = 60000 } = {}, onConfirmed, onTimeout) {
        if (!txid) {
            try {
                if (typeof onTimeout === 'function') onTimeout();
            } catch (e) {
                console.error('pollTxConfirmation onTimeout error:', e);
            }
            return;
        }
        const start = Date.now();
        const timeoutMillis = timeoutMs;
        let isCancelled = false;
        
        const tryCheck = async () => {
            if (isCancelled) return;
            
            try {
                // Try to see if tx still in pool
                let inPool = false;
                try {
                    if (this.ws && this.ws.sendRequest) {
                        const pool = await this.ws.sendRequest('DERO.GetTxPool', {});
                        const poolList = (pool && (pool.txs || pool.result?.txs)) || [];
                        if (Array.isArray(poolList)) {
                            inPool = !!poolList.find(t => (t.hash || t) === txid);
                        }
                    }
                } catch (_) {
                    // ignore if node doesn't expose this; fall back to time-based check
                }
                // Try to fetch transaction details
                let confirmed = false;
                try {
                    if (this.ws && this.ws.sendRequest) {
                        const resp = await this.ws.sendRequest('DERO.GetTransaction', { txs_hashes: [txid], decode_as_json: true });
                        const ok = resp && (resp.status === 'OK' || resp.result);
                        if (ok) {
                            const txs = resp.txs || resp.result?.txs || [];
                            if (Array.isArray(txs) && txs.length > 0) {
                                const t0 = txs[0];
                                // Heuristic: if not in pool and has block or in_pool === false, consider confirmed
                                if (t0.in_pool === false || t0.blockhash || typeof t0.block_height === 'number') {
                                    confirmed = true;
                                }
                            }
                        }
                    }
                } catch (_) {
                    // ignore
                }
                if (confirmed || (!inPool && Date.now() - start > 8000)) {
                    if (!isCancelled && typeof onConfirmed === 'function') {
                        try {
                            onConfirmed();
                        } catch (e) {
                            console.error('pollTxConfirmation onConfirmed error:', e);
                        }
                    }
                    return;
                }
                if (Date.now() - start >= timeoutMillis) {
                    if (!isCancelled && typeof onTimeout === 'function') {
                        try {
                            onTimeout();
                        } catch (e) {
                            console.error('pollTxConfirmation onTimeout error:', e);
                        }
                    }
                    return;
                }
                if (!isCancelled) {
                    setTimeout(tryAgain, intervalMs);
                }
            } catch (error) {
                console.error('pollTxConfirmation error:', error);
                // best effort: keep polling until timeout
                if (Date.now() - start >= timeoutMillis) {
                    if (!isCancelled && typeof onTimeout === 'function') {
                        try {
                            onTimeout();
                        } catch (e) {
                            console.error('pollTxConfirmation onTimeout error:', e);
                        }
                    }
                    return;
                }
                if (!isCancelled) {
                    setTimeout(tryAgain, intervalMs);
                }
            }
        };
        const tryAgain = () => { 
            if (!isCancelled) {
                tryCheck().catch(err => {
                    console.error('pollTxConfirmation tryCheck error:', err);
                });
            }
        };
        tryCheck().catch(err => {
            console.error('pollTxConfirmation initial tryCheck error:', err);
        });
        
        // Return cancellation function
        return () => { isCancelled = true; };
    }
}

// ========================================
// Core Asset Parsing Functions (moved from appfeat.js)
// ========================================

if (typeof DeroNFTApp !== 'undefined') {
    
    // Parsing helpers relocated to appfeat2.js

    // classifyAssetType moved to appfeat4.js

    // decodeHexString, sanitizePrintableString, applyAssetFilters, renderAssetsWithOrders, getAssetDisplayName, applyOwnershipUpdateFromAction, refreshSavedAssets moved to appfeat1.js and appfeat4.js

    /**
     * Centralized transaction error logging helper
     * Logs detailed error information to console and shows user-friendly notifications
     */
    DeroNFTApp.prototype.logTransactionError = function(context, error, details = {}) {
        const errorInfo = {
            timestamp: new Date().toISOString(),
            context: context,
            error: error?.message || error?.toString() || 'Unknown error',
            errorCode: error?.code || error?.error?.code,
            errorMessage: error?.error?.message || error?.message,
            details: details,
            stack: error?.stack
        };

        // Detailed console logging
        console.group('❌ [Transaction Error]', context);
        console.error('Error:', errorInfo.error);
        if (errorInfo.errorCode) console.error('Error Code:', errorInfo.errorCode);
        if (errorInfo.errorMessage) console.error('Error Message:', errorInfo.errorMessage);
        if (details.scid) console.error('Contract SCID:', details.scid);
        if (details.entrypoint) console.error('Entrypoint:', details.entrypoint);
        if (details.txid) console.error('Transaction ID:', details.txid);
        if (details.params) console.error('Request Params:', JSON.stringify(details.params, null, 2));
        if (details.response) console.error('Response:', JSON.stringify(details.response, null, 2));
        if (details.returnValue !== undefined) console.error('Contract Return Value:', details.returnValue);
        console.error('Full Error Info:', errorInfo);
        console.groupEnd();

        // User-friendly error message
        let userMessage = errorInfo.error;
        
        // Map common error codes to user-friendly messages
        if (errorInfo.errorCode === -32043) {
            userMessage = 'Permission denied: Wallet did not approve the transaction';
        } else if (errorInfo.errorCode === -32600) {
            userMessage = 'Invalid request parameters. Please check your inputs.';
        } else if (errorInfo.errorCode === -32601) {
            userMessage = 'Method not found. The contract may not support this function.';
        } else if (errorInfo.errorCode === -32602) {
            userMessage = 'Invalid parameters. Please verify all inputs are correct.';
        } else if (errorInfo.errorCode === -32603) {
            userMessage = 'Internal error. The wallet or network may be experiencing issues.';
        } else if (errorInfo.errorMessage) {
            userMessage = errorInfo.errorMessage;
        }

        // Add context-specific guidance
        if (context.includes('Sell Order') || context.includes('Listing')) {
            userMessage += ' Your asset should have been returned to your wallet.';
        } else if (context.includes('Buy Order')) {
            userMessage += ' Your DERO should have been returned to your wallet.';
        } else if (context.includes('Transfer')) {
            userMessage += ' The asset should still be in your wallet.';
        }

        // Show notification
        try {
            this.showError?.(userMessage);
        } catch (e) {
            console.error('Failed to show error notification:', e);
        }

        return errorInfo;
    };

    DeroNFTApp.prototype.callContractEntry = async function(scid, entrypoint, scRpc = [], options = {}) {
        if (!this.deroWallet || !this.deroWallet.ws) {
            const error = new Error('Wallet not connected');
            this.logTransactionError('callContractEntry - Wallet Check', error, { scid, entrypoint });
            throw error;
        }

        if (!scid || !entrypoint) {
            const error = new Error('Missing smart contract details');
            this.logTransactionError('callContractEntry - Validation', error, { scid, entrypoint });
            throw error;
        }

        if (!this.permissionDenyCache) {
            this.permissionDenyCache = new Set();
        }

        const cacheKey = `${scid}:${entrypoint}`;
        if (this.permissionDenyCache.has(cacheKey)) {
            const error = new Error('Permission previously denied for this action');
            this.logTransactionError('callContractEntry - Permission Cache', error, { scid, entrypoint });
            throw error;
        }

        const params = {
            scid: scid,
            ringsize: options.ringsize || 2,
            amount: typeof options.amount === 'number' ? options.amount : 0,
            sc_rpc: [
                {
                    name: 'entrypoint',
                    datatype: 'S',
                    value: entrypoint
                },
                ...scRpc
            ]
        };
        if (options.transfers && Array.isArray(options.transfers) && options.transfers.length > 0) {
            params.transfers = options.transfers;
            console.log('📤 [callContractEntry] Including transfers in request:', JSON.stringify(options.transfers, null, 2));
        } else {
            console.log('⚠️ [callContractEntry] No transfers provided in options');
        }
        if (typeof options.fees === 'number' && options.fees > 0) {
            params.fees = options.fees;
        }

        console.log('📤 [callContractEntry] Full transfer params:', JSON.stringify(params, null, 2));

        try {
            this.showNotification?.('Requesting wallet approval...', 'info');
            // API guide confirms: method name is 'transfer' (lowercase) for JSON-RPC 2.0
            // Section title shows "Transfer" but actual method name is lowercase
            const response = await this.deroWallet.ws.sendRequest('transfer', params);

            if (response && response.error) {
                const errorDetails = {
                    scid,
                    entrypoint,
                    params,
                    response,
                    errorCode: response.error.code,
                    errorMessage: response.error.message
                };
                
                if (response.error.code === -32043) {
                    this.permissionDenyCache.add(cacheKey);
                    const error = new Error('Permission not granted by wallet');
                    this.logTransactionError(`callContractEntry - ${entrypoint}`, error, errorDetails);
                    throw error;
                }
                
                const error = new Error(response.error.message || 'Smart contract call failed');
                this.logTransactionError(`callContractEntry - ${entrypoint}`, error, errorDetails);
                throw error;
            }

            // Successful call - clear any cached denial
            if (this.permissionDenyCache.has(cacheKey)) {
                this.permissionDenyCache.delete(cacheKey);
            }

            // Log successful transaction
            // Response can be: { txid: "..." } or { result: { txid: "...", value: ... } }
            const txid = response?.result?.txid ?? response?.txid;
            const returnValue = response?.result?.value ?? response?.value;
            console.log(`✅ [callContractEntry] Transaction successful:`, {
                entrypoint,
                scid: scid.substring(0, 16) + '...',
                txid,
                returnValue
            });

            // Global success toast with txid if present
            try {
                this.showNotification?.(`Transaction submitted${txid ? ` (txid: ${txid.substring(0, 16)}...)` : ''}.`, 'success');
            } catch (_) {}
            return response;
        } catch (error) {
            const errorDetails = {
                scid,
                entrypoint,
                params,
                errorCode: error?.code || error?.error?.code,
                errorMessage: error?.message || error?.error?.message
            };
            
            if (error && (error.code === -32043 || error.error?.code === -32043)) {
                this.permissionDenyCache.add(cacheKey);
                const permError = new Error('Permission not granted by wallet');
                this.logTransactionError(`callContractEntry - ${entrypoint}`, permError, errorDetails);
                throw permError;
            }
            
            this.logTransactionError(`callContractEntry - ${entrypoint}`, error, errorDetails);
            throw error instanceof Error ? error : new Error(error.message || 'Smart contract call failed');
        }
    }
        // splitAssetIdentifier now lives in appfeat2.js

    // orderMatchesAsset now lives in appfeat2.js
    // getAssetDisplayName moved to appfeat1.js
    // applyOwnershipUpdateFromAction moved to appfeat4.js

    // queryG45AT moved to appfeat4.js
}
