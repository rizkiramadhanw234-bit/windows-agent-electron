console.log('🖥️ Device Info JS loaded');

let config = null;
let uptimeInterval = null;
let startTime = Date.now();
let lastSyncTime = null;
let cameFromSetup = false;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ DOM loaded');
    
    // Cek jika datang dari setup wizard
    const urlParams = new URLSearchParams(window.location.search);
    cameFromSetup = urlParams.get('fromSetup') === 'true';
    
    if (cameFromSetup) {
        console.log('🎯 Coming from setup wizard, will auto-minimize in 5 seconds');
    }
    
    await loadDeviceInfo();
    startUptimeCounter();
    setupEventListeners();
    updateStatusIndicator();
    
    // Auto-minimize jika dari setup
    if (cameFromSetup && window.electronAPI && window.electronAPI.minimizeToTray) {
        setTimeout(() => {
            console.log('⏰ Auto-minimizing to tray...');
            window.electronAPI.minimizeToTray();
        }, 5000);
    }
});

function minimizeWindow() {
    if (window.electronAPI && window.electronAPI.minimizeToTray) {
        window.electronAPI.minimizeToTray();
        showMessage('Minimized to system tray', 'info');
    } else {
        showMessage('Cannot minimize to tray', 'warning');
    }
}


async function loadDeviceInfo() {
    try {
        console.log('📋 Loading device information...');

        // Get config from Electron
        config = await window.electronAPI.getConfig();
        
        if (!config) {
            console.warn('No configuration found, showing setup wizard...');
            showMessage('No configuration found. Please run setup wizard.', 'warning');
            
            // Auto-open setup wizard if no config
            setTimeout(() => {
                if (window.electronAPI && window.electronAPI.showSetupWizard) {
                    window.electronAPI.showSetupWizard();
                }
            }, 2000);
            return;
        }

        console.log('✅ Config loaded:', {
            agentId: config.agentId,
            company: config.companyName,
            backendUrl: config.backendUrl
        });

        // Populate device info
        document.getElementById('deviceName').textContent = config.hostname || 'Unknown Device';
        document.getElementById('agentId').textContent = config.agentId || 'N/A';
        document.getElementById('companyName').textContent = config.companyName || '-';
        document.getElementById('department').textContent = config.departmentName || '-';
        document.getElementById('location').textContent = config.companyAddress || config.location || '-';
        document.getElementById('contactPerson').textContent = config.contactPerson || '-';
        document.getElementById('phone').textContent = config.companyPhone || config.phone || '-';
        document.getElementById('email').textContent = config.companyEmail || '-';
        
        // System info
        document.getElementById('hostname').textContent = config.hostname || '-';
        document.getElementById('platform').textContent = config.platform || 'Windows';
        document.getElementById('macAddress').textContent = config.macAddress || '-';
        document.getElementById('backendUrl').textContent = config.backendUrl || '-';
        document.getElementById('websocketUrl').textContent = config.websocketUrl || '-';
        document.getElementById('agentVersion').textContent = config.agentVersion || '1.0.0';
        
        // Registered date
        if (config.registeredAt) {
            const date = new Date(config.registeredAt);
            document.getElementById('registeredAt').textContent = date.toLocaleString();
        } else {
            document.getElementById('registeredAt').textContent = 'Not registered';
        }

        // Load printer count (you'll need to implement this in your agent)
        const printerCount = await getPrinterCount();
        if (printerCount !== null) {
            document.getElementById('printerCount').textContent = printerCount;
        }

        // Load last sync time
        lastSyncTime = config.lastSeen || config.lastSync;
        updateLastSyncDisplay();

        console.log('✅ Device info loaded successfully');

    } catch (error) {
        console.error('❌ Failed to load device info:', error);
        showMessage(`Error loading device info: ${error.message}`, 'error');
        document.getElementById('deviceName').textContent = 'Error Loading Data';
    }
}

function startUptimeCounter() {
    startTime = Date.now();
    
    uptimeInterval = setInterval(() => {
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        document.getElementById('uptime').textContent = `${hours}h ${minutes}m`;
    }, 1000);
}

function updateLastSyncDisplay() {
    if (!lastSyncTime) {
        document.getElementById('lastSync').textContent = 'Never';
        return;
    }
    
    const date = new Date(lastSyncTime);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    
    let text;
    if (diff < 60) {
        text = 'Just now';
    } else if (diff < 3600) {
        text = `${Math.floor(diff / 60)}m ago`;
    } else if (diff < 86400) {
        text = `${Math.floor(diff / 3600)}h ago`;
    } else {
        text = date.toLocaleDateString();
    }
    
    document.getElementById('lastSync').textContent = text;
}

function setupEventListeners() {
    // Listen for agent status updates (if implemented)
    if (window.ipcRenderer) {
        window.ipcRenderer.on('agent-status-update', (event, data) => {
            console.log('Agent status update:', data);
            updateStatusIndicator(data.status);
        });
        
        window.ipcRenderer.on('agent-synced', (event, data) => {
            console.log('Agent synced:', data);
            lastSyncTime = new Date().toISOString();
            updateLastSyncDisplay();
            showMessage('Data synced successfully', 'success');
        });
        
        window.ipcRenderer.on('agent-error', (event, error) => {
            console.error('Agent error:', error);
            showMessage(`Agent error: ${error.message}`, 'error');
            updateStatusIndicator('error');
        });
    }
}

function updateStatusIndicator(status) {
    const statusBadge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    
    if (!status) {
        // Get status from config or default
        status = config?.status || 'offline';
    }
    
    statusBadge.className = 'status-badge';
    statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    
    switch (status.toLowerCase()) {
        case 'online':
        case 'connected':
            statusBadge.classList.add('status-online');
            break;
        case 'offline':
        case 'disconnected':
            statusBadge.classList.add('status-offline');
            break;
        case 'error':
            statusBadge.classList.add('status-error');
            break;
        case 'warning':
            statusBadge.classList.add('status-warning');
            break;
        default:
            statusBadge.classList.add('status-unknown');
    }
}

async function getPrinterCount() {
    try {
        // This should call your agent's API to get printer count
        // For now, return from config or default
        return config?.printerCount || 0;
    } catch (error) {
        console.error('Error getting printer count:', error);
        return 0;
    }
}

// Action Functions
async function refreshData() {
    console.log('🔄 Refreshing device info...');
    showMessage('Refreshing data...', 'info');
    
    try {
        await loadDeviceInfo();
        showMessage('Data refreshed successfully', 'success');
    } catch (error) {
        showMessage(`Failed to refresh: ${error.message}`, 'error');
    }
}

async function testConnection() {
    const backendUrl = config?.backendUrl;
    if (!backendUrl) {
        showMessage('No backend URL configured', 'error');
        return;
    }
    
    showMessage(`Testing connection to ${backendUrl}...`, 'info');
    
    try {
        const result = await window.electronAPI.testConnection(backendUrl);
        
        if (result.success) {
            showMessage(`✅ Connected! ${result.data?.status || 'OK'} v${result.data?.version || '1.0.0'}`, 'success');
        } else {
            showMessage(`❌ Connection failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`❌ Error: ${error.message}`, 'error');
    }
}

async function restartAgent() {
    if (!confirm('Restart the printer monitoring agent? This will briefly interrupt monitoring.')) {
        return;
    }
    
    showMessage('Restarting agent...', 'info');
    
    try {
        const result = await window.electronAPI.restartAgent();
        
        if (result?.success) {
            showMessage('✅ Agent restarted successfully!', 'success');
        } else {
            showMessage(`❌ Failed to restart agent: ${result?.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        showMessage(`❌ Error: ${error.message}`, 'error');
    }
}

function showLogs() {
    if (window.electronAPI && window.electronAPI.openAgentLogs) {
        window.electronAPI.openAgentLogs();
        showMessage('Opening agent logs...', 'info');
    } else {
        showMessage('Log viewer not available', 'warning');
    }
}

function minimizeToTray() {
    if (window.electronAPI && window.electronAPI.minimizeToTray) {
        window.electronAPI.minimizeToTray();
    } else {
        showMessage('Cannot minimize to tray', 'warning');
    }
}

async function resetConfiguration() {
    if (!confirm('Are you sure you want to reset the configuration? This will remove all settings and require re-registration.')) {
        return;
    }
    
    showMessage('Resetting configuration...', 'warning');
    
    try {
        const result = await window.electronAPI.resetConfig();
        
        if (result?.success) {
            showMessage('✅ Configuration reset. Please run setup wizard.', 'success');
            
            // Show setup wizard after reset
            setTimeout(() => {
                if (window.electronAPI && window.electronAPI.showSetupWizard) {
                    window.electronAPI.showSetupWizard();
                }
            }, 1500);
        } else {
            showMessage(`❌ Failed to reset: ${result?.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        showMessage(`❌ Error: ${error.message}`, 'error');
    }
}

function showMessage(text, type = 'info') {
    const messagesContainer = document.getElementById('statusMessages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `status-message ${type}`;
    messageDiv.innerHTML = `
        <i class="fas fa-${getMessageIcon(type)}"></i>
        <span>${text}</span>
        <button class="message-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    messagesContainer.appendChild(messageDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode === messagesContainer) {
            messageDiv.remove();
        }
    }, 5000);
}

function getMessageIcon(type) {
    switch (type) {
        case 'success': return 'check-circle';
        case 'error': return 'exclamation-circle';
        case 'warning': return 'exclamation-triangle';
        case 'info': return 'info-circle';
        default: return 'info-circle';
    }
}

// Cleanup
window.addEventListener('beforeunload', () => {
    if (uptimeInterval) {
        clearInterval(uptimeInterval);
    }
});

// Export for debugging
window.deviceInfo = {
    refreshData,
    testConnection,
    restartAgent,
    resetConfiguration,
    getConfig: () => config
};