import Store from 'electron-store';
import { hostname, platform, networkInterfaces, homedir } from 'os';
import { join } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';
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
    // Error handled silently
  }
  return '00:00:00:00:00:00';
}

function validateWebsocketUrl(url) {
  if (!url) return null;

  url = url.trim();

  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    return null;
  }

  const protocolMatch = url.match(/^(wss?):\/\/(.+)$/);
  if (!protocolMatch) {
    return null;
  }

  const [, protocol, rest] = protocolMatch;

  if (rest.includes('https:') || (rest.includes('http:') && !rest.startsWith('http'))) {
    const cleanRest = rest.replace(/^https?:\/+/, '');
    return `${protocol}://${cleanRest}`;
  }

  return url;
}

class ConfigManager {
  constructor() {
    this.configPath = join(homedir(), 'AppData', 'Roaming', 'printer-agent-desktop', 'agent-config.json');

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
      if (!config.agentToken && config.agent_token) {
        config.agentToken = config.agent_token;
      }

      if (config.websocketUrl) {
        const validatedUrl = validateWebsocketUrl(config.websocketUrl);
        if (validatedUrl) {
          config.websocketUrl = validatedUrl;
        }
      }

      config.configured = true;
      config.lastUpdated = new Date().toISOString();

      this.store.set(config);

      try {
        writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      } catch (fileErr) {
        // Error handled silently
      }

      return config;
    } catch (error) {
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
      // Error handled silently
    }
  }

  getConfig() {
    const config = this.store.store;

    if (config && config.websocketUrl) {
      const validatedUrl = validateWebsocketUrl(config.websocketUrl);
      if (validatedUrl && validatedUrl !== config.websocketUrl) {
        config.websocketUrl = validatedUrl;
      }
    }

    return config.configured ? config : null;
  }

  updateConfig(updates) {
    const current = this.getConfig() || {};

    if (updates.websocketUrl) {
      const validatedUrl = validateWebsocketUrl(updates.websocketUrl);
      if (validatedUrl) {
        updates.websocketUrl = validatedUrl;
      }
    }

    const updated = {
      ...current,
      ...updates,
      lastUpdated: new Date().toISOString()
    };

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
    if (!config || !config.websocketUrl) return null;

    const validatedUrl = validateWebsocketUrl(config.websocketUrl);
    return validatedUrl || config.websocketUrl;
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