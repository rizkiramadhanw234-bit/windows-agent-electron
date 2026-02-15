import Store from 'electron-store';
import { hostname, platform, networkInterfaces, homedir } from 'os';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { getDirname } from './esm-utils.js';

const __dirname = getDirname(import.meta.url);

function getMacAddress() {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac;
        }
      }
    }
  } catch (err) {
    console.error('Error getting MAC address:', err);
  }
  return '00:00:00:00:00:00';
}

class ConfigManager {
  constructor() {
    this.store = new Store({
      name: 'printer-agent-config',
      encryptionKey: 'printer-agent-encryption-key-2024',
      defaults: {
        version: '1.0.0',
        configured: false,
        backendUrl: '',
        websocketUrl: '',
        agentId: '',
        agentToken: '',
        apiKey: '',
        company: '',
        department: '',
        location: '',
        contactPerson: '',
        phone: '',
        hostname: hostname(),
        platform: platform(),
        macAddress: getMacAddress(),
        registeredAt: null,
        lastSync: null,
        autoStart: true,
        runAsService: false
      }
    });
  }

  saveConfig(config) {
  try {
    console.log('💾 Saving config with data:', {
      agentId: config.agentId,
      agentToken: config.agentToken ? 'YES' : 'NO',
      apiKey: config.apiKey ? 'YES' : 'NO'
    });

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

  saveBackup(config) {
    try {
      const backupPath = join(homedir(), 'printer-agent-backup.json');
      const backupData = {
        ...config,
        backupCreated: new Date().toISOString()
      };
      writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save backup:', err);
    }
  }

  getConfig() {
    const config = this.store.store;
    return config.configured ? config : null;
  }

  updateConfig(updates) {
    const current = this.getConfig() || {};
    const updated = { ...current, ...updates, lastUpdated: new Date().toISOString() };
    this.store.set(updated);
    return updated;
  }

  deleteConfig() {
    this.store.clear();
  }

  isConfigured() {
    const config = this.getConfig();
    return config && config.configured && config.agentToken;
  }

  getBackendUrl() {
    const config = this.getConfig();
    return config ? config.backendUrl : null;
  }

  getWebsocketUrl() {
    const config = this.getConfig();
    return config ? config.websocketUrl : null;
  }

  getAgentToken() {
    const config = this.getConfig();
    return config ? config.agentToken : null;
  }

  getAgentId() {
    const config = this.getConfig();
    return config ? config.agentId : null;
  }

  getRegistrationData() {
    const config = this.getConfig();
    if (!config) return null;

    return {
      hostname: config.hostname,
      macAddress: config.macAddress,
      company: config.company,
      department: config.department,
      location: config.location,
      contactPerson: config.contactPerson,
      phone: config.phone,
      customAgentId: config.agentId,
      platform: config.platform
    };
  }
}

export default new ConfigManager();
export function getConfig() {
  return ConfigManager.getConfig();
}