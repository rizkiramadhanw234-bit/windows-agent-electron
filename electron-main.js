import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } from 'electron';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getStorageManager } from './storage-manager.js';
import { enableAutoStart } from './windows-autostart.js';
import { unlinkSync } from "fs";
import serviceManager from './windows-service.js';
import os from 'os';
import crypto from 'crypto';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize storage
const storage = getStorageManager();
console.log('Storage manager loaded');

// Config manager
class ConfigManager {
  constructor() {
    this.configPath = join(app.getPath('userData'), 'agent-config.json');
  }
  saveConfig(config) {
    try {
      if (!config.agentToken && config.agent_token) {
        config.agentToken = config.agent_token;
      }

      config.configured = true;
      config.lastUpdated = new Date().toISOString();
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      console.log('💾 Config saved WITH agentToken!');
      return config;
    } catch (error) {
      console.error('Failed to save config:', error);
      throw error;
    }
  }

  getConfig() {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return null;
  }

  deleteConfig() {
    try {
      if (existsSync(this.configPath)) {
        unlinkSync(this.configPath);
        console.log("🗑️ Config file deleted");
      }
    } catch (error) {
      console.error("Failed to delete config:", error);
    }
  }

  isConfigured() {
    const config = this.getConfig();
    return config && config.configured === true && config.agentId && config.backendUrl;
  }
}

const configManager = new ConfigManager();

let mainWindow = null;
let tray = null;
let agentProcess = null;
let isAgentRunning = false;

// =============== STORAGE IPC HANDLERS ===============
ipcMain.handle('storage:get', async (event, key) => {
  const value = storage.get(key);
  return value;
});

ipcMain.handle('storage:set', async (event, key, value) => {
  storage.set(key, value);
  return { success: true };
});

ipcMain.handle('storage:delete', async (event, key) => {
  const deleted = storage.delete(key);
  return { success: deleted };
});

ipcMain.handle('storage:getAll', async () => {
  return storage.getAll();
});

ipcMain.handle('storage:clear', async () => {
  storage.clear();
  return { success: true };
});

// Broadcast storage changes
storage.on('changed', (data) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('storage:changed', data);
    }
  });
});

storage.on('cloud-synced', (data) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('storage:cloud-synced', { timestamp: Date.now() });
    }
  });
});

console.log('✅ Storage IPC handlers registered');

// =============== CONFIG IPC HANDLERS ===============
ipcMain.handle('get-config', async () => {
  return configManager.getConfig();
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    console.log('💾 Saving config with auth data:', {
      agentId: config.agentId,
      apiKey: config.apiKey ? 'YES' : 'NO',
      backendUrl: config.backendUrl
    });

    const saved = configManager.saveConfig(config);
    console.log('✅ Config saved successfully');
    return { success: true, config: saved };
  } catch (error) {
    console.error('Failed to save config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-config', async () => {
  try {
    configManager.deleteConfig();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// =============== SYSTEM INFO ===============
ipcMain.handle('get-system-info', () => {
  let macAddress = '00:00:00:00:00:00';
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          macAddress = net.mac;
          break;
        }
      }
      if (macAddress !== '00:00:00:00:00:00') break;
    }
  } catch (err) {
    console.error('Failed to get MAC:', err);
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    macAddress: macAddress
  };
});

// =============== CONNECTION TEST ===============
ipcMain.handle('test-connection', async (event, backendUrl) => {
  try {
    console.log(`🔌 Testing connection to: ${backendUrl}`);

    let cleanUrl = backendUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'http://' + cleanUrl;
    }
    cleanUrl = cleanUrl.replace(/\/$/, '');

    console.log(`🌐 Clean URL: ${cleanUrl}`);

    const response = await axios.get(`${cleanUrl}/api/health`, {
      timeout: 5000,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    console.log('✅ Connection successful:', {
      status: response.status,
      data: response.data
    });

    return {
      success: true,
      data: response.data,
      status: response.data?.status || 'OK',
      version: response.data?.version || '1.0.0'
    };

  } catch (error) {
    console.error('❌ Connection failed:', error.message);

    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        error: 'Connection refused. Make sure backend is running on ' + backendUrl
      };
    } else if (error.code === 'ENOTFOUND') {
      return {
        success: false,
        error: 'Host not found. Check the URL or network connection'
      };
    } else if (error.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: 'Connection timeout. Server might be slow or unreachable'
      };
    }

    return {
      success: false,
      error: error.message || 'Connection failed'
    };
  }
});

// =============== AGENT REGISTRATION ===============
ipcMain.handle('register-agent', async (event, agentData) => {
  try {
    console.log('📝 [Electron] Registering agent with data:', JSON.stringify(agentData, null, 2));

    // Validate required fields
    if (!agentData || !agentData.backend_url) {
      throw new Error('Missing required agent data: backend_url');
    }

    // Generate API key
    const apiKey = generateRandomAPIKey(32);

    // Generate agent ID jika tidak ada
    const agentId = agentData.agent_id || `AGENT_${generateRandomString(8)}_${generateRandomString(6)}`;

    console.log('🆔 Generated Agent ID:', agentId);
    console.log('🔑 Generated API Key (first 12):', apiKey.substring(0, 12) + '...');

    // Dapatkan system info
    const systemInfo = {
      hostname: os.hostname(),
      platform: os.platform()
    };

    // Cari MAC address
    let macAddress = '00:00:00:00:00:00';
    try {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            macAddress = net.mac;
            break;
          }
        }
        if (macAddress !== '00:00:00:00:00:00') break;
      }
    } catch (err) {
      console.error('Failed to get MAC:', err);
    }

    // **PAYLOAD SESUAI DENGAN YANG DIHARAPKAN BACKEND (camelCase)**
    const backendUrl = agentData.backend_url.replace(/\/$/, '');
    console.log('📤 Sending registration to backend:', `${backendUrl}/api/agents/register`);

    // **INI FORMAT YANG BENAR UNTUK BACKEND: camelCase!**
    const registrationPayload = {
      // Field WAJIB sesuai backend (camelCase)
      hostname: agentData.hostname || systemInfo.hostname,
      macAddress: agentData.mac_address || macAddress,
      contactPerson: agentData.contact_person || agentData.company_name || 'Admin',

      // Field optional sesuai backend
      company: agentData.company_name || '',
      department: agentData.department || '',
      departmentId: agentData.departement_id || 0,
      location: agentData.location || '',
      phone: agentData.company_phone || '',
      customAgentId: agentId, // customAgentId untuk override UUID
      platform: agentData.platform || systemInfo.platform,

      // Tambahan field yang mungkin dibutuhkan
      apiKey: apiKey,
      agentToken: '', // Backend akan generate sendiri

      // Field untuk backward compatibility (snake_case)
      agent_id: agentId,
      agent_name: agentData.name || agentId,
      name: agentData.name || agentId,
      ip_address: agentData.ip_address || '127.0.0.1',
      company_id: agentData.company_id,
      company_name: agentData.company_name,
      license_key: agentData.license_key,
      departement_id: agentData.departement_id || 0,
      registered_at: new Date().toISOString(),
      agent_version: '1.0.0'
    };

    console.log('📦 Registration payload to backend:', JSON.stringify(registrationPayload, null, 2));

    // Kirim ke backend
    const response = await fetch(`${backendUrl}/api/agents/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationPayload)
    });

    const responseText = await response.text();
    console.log('📥 Backend response status:', response.status);
    console.log('📥 Backend response body:', responseText);

    if (!response.ok) {
      let errorMessage = `Backend registration failed: ${response.status}`;
      try {
        const errorData = JSON.parse(responseText);
        errorMessage += ` ${JSON.stringify(errorData)}`;
      } catch {
        errorMessage += ` ${responseText}`;
      }
      throw new Error(errorMessage);
    }

    // Parse response
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      throw new Error(`Invalid JSON response from backend: ${responseText}`);
    }

    console.log('✅ Backend registration response:', responseData);

    if (!responseData.success) {
      throw new Error(`Backend returned error: ${responseData.error || 'Unknown error'}`);
    }

    // **Simpan config ke file .env dan agent.key dengan API key dari RESPONSE backend**
    await saveAgentConfig({
      agentId: responseData.agentId || agentId,
      agentToken: responseData.agentToken,
      apiKey: responseData.apiKey || apiKey,
      backendUrl: agentData.backend_url,
      websocketUrl: responseData.websocketUrl,
      company_id: agentData.company_id,
      company_name: agentData.company_name,
      departmentId: agentData.departement_id,
    });

    // Simpan configuration lengkap ke agent-config.json
    const fullConfig = {
      agentId: responseData.agentId || agentId,
      apiKey: responseData.apiKey || apiKey, // Pakai dari response backend
      agentToken: responseData.agentToken || '',
      backendUrl: agentData.backend_url,
      websocketUrl: responseData.websocketUrl || agentData.backend_url.replace('http', 'ws') + '/ws/agent',
      hostname: agentData.hostname || systemInfo.hostname,
      macAddress: agentData.mac_address || macAddress,
      platform: agentData.platform || systemInfo.platform,
      ipAddress: agentData.ip_address || '127.0.0.1',
      companyId: agentData.company_id,
      companyName: agentData.company_name,
      companyAddress: agentData.company_address,
      companyEmail: agentData.company_email,
      companyPhone: agentData.company_phone,
      licenseKey: agentData.license_key,
      departmentId: agentData.departement_id,
      contactPerson: agentData.contact_person || agentData.company_name,
      status: 'active',
      configured: true,
      registeredAt: new Date().toISOString(),
      backendResponse: responseData // Simpan full response untuk debugging
    };

    configManager.saveConfig(fullConfig);

    return {
      success: true,
      agent_id: responseData.agentId || agentId,
      api_key: responseData.apiKey || apiKey,
      agent_token: responseData.agentToken || '',
      websocket_url: responseData.websocketUrl || agentData.backend_url.replace('http', 'ws') + '/ws/agent',
      data: responseData
    };
  } catch (error) {
    console.error('❌ [Electron] Registration error:', error);
    return {
      success: false,
      error: `Registration failed: ${error.message}`
    };
  }
});

async function saveAgentConfig(config) {
  const fs = await import('fs').then(module => module);

  const agentToken = config.agent_token || config.agentToken || '';
  const apiKey = config.api_key || config.apiKey || '';
  const agentId = config.agent_id || config.agentId || '';
  const backendUrl = config.backend_url || config.backendUrl || '';
  const websocketUrl = config.websocket_url || config.websocketUrl || '';

  const envContent = `# Printer Agent Configuration
AGENT_TOKEN=${agentToken}
CLOUD_API_KEY=${apiKey}
AGENT_ID=${agentId}
BACKEND_URL=${backendUrl}
CLOUD_WS_URL=${websocketUrl}
CLOUD_ENABLED=true
HTTP_PORT=5001
NODE_ENV=production
`;

  const envPath = join(app.getPath('userData'), '.env');
  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('✅ .env saved to:', envPath);

  return true;
}



// Helper untuk generate random string
function generateRandomString(length) {
  return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

// Helper untuk generate random API key menggunakan crypto
function generateRandomAPIKey(length) {
  return crypto.randomBytes(length).toString('hex');
}

// =============== AGENT CONTROL ===============
ipcMain.handle('start-agent', () => {
  console.log('Starting agent...');
  startAgent();
  return { success: true, message: 'Agent started' };
});

ipcMain.handle('stop-agent', () => {
  console.log('Stopping agent...');
  stopAgent();
  return { success: true, message: 'Agent stopped' };
});


// =============== SETUP COMPLETE ===============
ipcMain.handle('setup-complete', async () => {
  console.log('🔧 Setup complete, creating main window...');

  try {
    // Enable auto-start
    enableAutoStart();
    console.log('✅ Auto-start enabled');

    // Close setup windows
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(win => {
      if (win !== mainWindow) {
        win.close();
      }
    });

    // Create device info window
    createMainWindow();


    // Start agent
    startAgent();

    return { success: true };
  } catch (error) {
    console.error('Error completing setup:', error);
    return { success: false, error: error.message };
  }
});

// =============== SERVICE MANAGEMENT ===============
ipcMain.handle('install-service', async () => {
  try {
    console.log('🔧 Installing Windows service...');

    const config = configManager.getConfig();
    if (!config) {
      throw new Error('No configuration found');
    }

    const result = await serviceManager.installAsService(config);
    console.log('✅ Service installed:', result);

    return result;

  } catch (error) {
    console.error('Service installation error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('service-status', async () => {
  try {
    const installed = await serviceManager.isServiceInstalled();
    return {
      installed: installed,
      running: installed,
      name: 'PrinterDashboardAgent'
    };
  } catch (error) {
    return {
      installed: false,
      running: false,
      error: error.message
    };
  }
});

ipcMain.handle('restart-service', async () => {
  try {
    const result = await serviceManager.restartService();
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('open-device-info', async () => {
  console.log('🖥️ Opening Device Info window...');

  // Cek jika main window sudah ada
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Load device info page
    const deviceInfoPath = join(__dirname, 'ui', 'device-info.html');
    if (existsSync(deviceInfoPath)) {
      mainWindow.loadFile(deviceInfoPath);
    } else {
      console.error('❌ device-info.html not found!');
      return { success: false, error: 'Device info page not found' };
    }

    mainWindow.show();
    mainWindow.focus();
    return { success: true };
  }

  // Jika tidak ada window, buat baru
  return createMainWindow();
});

// Juga tambahkan handler untuk minimize to tray
ipcMain.handle('minimize-to-tray', async () => {
  console.log('📌 Minimizing to tray...');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();

    // Show tray notification
    if (tray) {
      tray.displayBalloon({
        title: 'Printer Agent',
        content: 'Agent is running in system tray',
        iconType: 'info'
      });
    }

    return { success: true };
  }

  return { success: false, error: 'No window to minimize' };
});

console.log('✅ Service IPC handlers registered');

// =============== RESET CONFIG ===============
ipcMain.handle('reset-config', async () => {
  console.log('🔄 Resetting configuration...');

  try {
    // 1. Hapus config file
    configManager.deleteConfig();
    console.log('✅ Config deleted');

    // 2. Clear storage
    storage.clear();
    console.log('✅ Storage cleared');

    // 3. Hapus .env file jika ada
    const envPath = join(app.getPath('userData'), '.env');
    if (existsSync(envPath)) {
      const fs = await import('fs');
      fs.unlinkSync(envPath);
      console.log('🗑️ .env file deleted');
    }

    // 4. Hapus backup .env di userData
    const userDataPath = app.getPath('userData');
    const userDataEnv = join(userDataPath, '.env');
    if (existsSync(userDataEnv)) {
      const fs = await import('fs');
      fs.unlinkSync(userDataEnv);
      console.log('🗑️ Backup .env deleted');
    }

    // 5. Stop agent jika running
    if (agentProcess && isAgentRunning) {
      console.log('Stopping agent process...');
      agentProcess.kill('SIGTERM');
      isAgentRunning = false;
      agentProcess = null;
    }

    // 6. Show wizard
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(join(__dirname, 'ui', 'setup-wizard.html'));
      mainWindow.show();
    }

    return { success: true, message: 'Configuration reset successfully' };

  } catch (error) {
    console.error('❌ Error resetting config:', error);
    return { success: false, error: error.message };
  }
});

// =============== CLOSE APP ===============
ipcMain.handle('close-app', () => {
  console.log('Closing app...');

  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    win.close();
  });

  setTimeout(() => {
    app.exit(0);
  }, 1000);

  return { success: true };
});

// =============== CREATE MAIN WINDOW (Device Info) ===============
function createMainWindow() {
  console.log('🖥️ Creating main application window...');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }

  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: 'Printer Agent - Device Information'
  });

  const deviceInfoPath = join(__dirname, 'ui', 'device-info.html');
  console.log('Loading device info from:', deviceInfoPath);

  if (existsSync(deviceInfoPath)) {
    mainWindow.loadFile(deviceInfoPath);
  } else {
    console.error('❌ device-info.html not found!');
    // Fallback to setup
    mainWindow.loadFile(join(__dirname, 'ui', 'setup-wizard.html'));
  }

  mainWindow.once('ready-to-show', () => {
    Menu.setApplicationMenu(null);
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('✅ Main window created');
  console.log(mainWindow)
  return mainWindow;
}

// =============== AGENT MANAGEMENT ===============
function startAgent() {
  if (isAgentRunning) {
    console.log('Agent already running');
    return;
  }

  const config = configManager.getConfig();
  if (!config || !config.backendUrl || !config.agentId) {
    console.error('No configuration found or incomplete');
    return;
  }

  // ✅ BACA .env DULU
  const userDataPath = app.getPath('userData');
  console.log('📁 User data path:', userDataPath);
  const envPath = join(userDataPath, 'agent.env');

  let agentToken = config.agentToken || '';
  let apiKey = config.apiKey || '';
  let websocketUrl = config.websocketUrl || 'ws://localhost:3001/ws/agent';
  let backendUrl = config.backendUrl;
  let agentId = config.agentId;

  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, 'utf8');
      const tokenMatch = envContent.match(/AGENT_TOKEN=([^\n]+)/);
      if (tokenMatch) agentToken = tokenMatch[1].trim();
    } catch (e) { }
  }

  // ✅ PAKE process.execPath, BUKAN 'node'!
  const isDev = !app.isPackaged;
  const agentScript = isDev
    ? join(__dirname, 'src', 'index.js')
    : join(process.resourcesPath, 'app.asar', 'src', 'index.js');

  console.log('🚀 Starting agent with:', {
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    script: agentScript
  });

  agentProcess = spawn(process.execPath, [agentScript], {
    cwd: isDev ? __dirname : process.resourcesPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_RUN_AS_NODE: '1',
      AGENT_TOKEN: agentToken,
      CLOUD_API_KEY: apiKey,
      CLOUD_WS_URL: websocketUrl,
      AGENT_ID: agentId,
      BACKEND_URL: backendUrl,
      HTTP_PORT: '5001',
      USER_DATA_PATH: userDataPath,
      CLOUD_ENABLED: 'true'
    }
  });

  agentProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`[Agent] ${output}`);

      if (output.includes('Connecting to backend:')) {
        console.log('🔗 Agent is connecting to:', output);
      }
      if (output.includes('Connected to Backend')) {
        console.log('✅ Agent successfully connected to backend!');
      }
      if (output.includes('WebSocket error') || output.includes('Disconnected from backend')) {
        console.log('❌ WebSocket connection issue detected');
        console.log('   Expected URL:', websocketUrl);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-log', output);
      }
    }
  });

  agentProcess.stderr.on('data', (data) => {
    const error = data.toString().trim();
    if (error) {
      console.error(`[Agent Error] ${error}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-error', error);
      }
    }
  });

  agentProcess.on('close', (code) => {
    console.log(`Agent process exited with code ${code}`);
    isAgentRunning = false;
    agentProcess = null;

    setTimeout(() => {
      if (!app.isQuitting) {
        console.log('Auto-restarting agent...');
        startAgent();
      }
    }, 5000);
  });

  agentProcess.on('error', (err) => {
    console.error('Failed to start agent:', err);
    isAgentRunning = false;
    agentProcess = null;
  });

  isAgentRunning = true;
  console.log('Agent started successfully with WebSocket URL:', websocketUrl);
}


function stopAgent() {
  if (agentProcess && !agentProcess.killed) {
    console.log('Stopping agent process...');
    agentProcess.kill('SIGTERM');
    agentProcess = null;
  }
  isAgentRunning = false;
}

// =============== SETUP WINDOW (First Time) ===============
function createWindow() {
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    icon: join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      devTools: true
    },
    show: false,
    frame: true,
    title: 'Printer Agent Setup'
  });

  const config = configManager.getConfig();
  const isConfigured = configManager.isConfigured();

  console.log('=== AGENT CONFIG CHECK ===');
  console.log('Config exists:', !!config);
  console.log('Configured flag:', config?.configured);
  console.log('Agent ID:', config?.agentId);
  console.log('Backend URL:', config?.backendUrl);
  console.log('Is configured:', isConfigured);
  console.log('==========================');

  // Load setup wizard atau device info
  if (isConfigured) {
    console.log('📋 Loading device info...');
    const deviceInfoPath = join(__dirname, 'ui', 'device-info.html');
    if (existsSync(deviceInfoPath)) {
      mainWindow.loadFile(deviceInfoPath);
    } else {
      mainWindow.loadFile(join(__dirname, 'ui', 'setup-wizard.html'));
    }
  } else {
    console.log('📋 Loading setup wizard...');
    mainWindow.loadFile(join(__dirname, 'ui', 'setup-wizard.html'));
  }

  mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // mainWindow.webContents.openDevTools();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// =============== TRAY ===============
async function createTray() {
  try {
    const iconPath = join(__dirname, 'assets', 'icon.ico');
    let icon;

    if (existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        icon = createDefaultIcon();
      }
    } else {
      icon = createDefaultIcon();
    }

    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Device Information',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            createMainWindow();
          }
        }
      },
      {
        label: `Status: ${isAgentRunning ? 'Running' : 'Stopped'}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Start Agent',
        click: () => startAgent(),
        enabled: !isAgentRunning
      },
      {
        label: 'Stop Agent',
        click: () => stopAgent(),
        enabled: isAgentRunning
      },
      { type: 'separator' },
      {
        label: 'Reset Configuration',
        click: () => {
          configManager.deleteConfig();
          storage.clear();
          if (mainWindow) {
            mainWindow.loadFile(join(__dirname, 'ui', 'setup-wizard.html'));
            mainWindow.show();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Exit Agent',
        click: () => {
          app.isQuitting = true;
          stopAgent();
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Printer Dashboard Agent');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
      } else {
        createMainWindow();
      }
    });

    console.log('✅ Tray created successfully');

  } catch (error) {
    console.error('❌ Tray error:', error.message);
  }
}

function createDefaultIcon() {
  const size = 32;
  const iconData = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;

      const blue = 255;
      const green = Math.floor(100 + (x / size) * 155);
      const red = Math.floor(50 + (y / size) * 100);

      iconData[offset] = red;
      iconData[offset + 1] = green;
      iconData[offset + 2] = blue;
      iconData[offset + 3] = 255;
    }
  }

  return nativeImage.createFromBuffer(iconData, {
    width: size,
    height: size
  });
}

// =============== APP LIFECYCLE ===============
app.whenReady().then(() => {
  console.log('App ready, creating window...');
  createWindow();
  createTray();

  // Auto-start agent if configured
  const config = configManager.getConfig();
  if (config && configManager.isConfigured()) {
    console.log('✅ Config found, auto-starting agent...');
    setTimeout(() => {
      startAgent();
    }, 2000);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep app running in tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopAgent();
  storage.cleanup();
});