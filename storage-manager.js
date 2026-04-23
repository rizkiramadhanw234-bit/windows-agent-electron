import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import EventEmitter from 'events';
import axios from 'axios';

class StorageManager extends EventEmitter {
  constructor() {
    super();

    const userDataPath = app.getPath('userData');
    this.storagePath = join(userDataPath, 'agent-storage.json');

    this.cache = new Map();
    this.isDirty = false;
    this.autoSaveInterval = null;
    this.cloudSyncInterval = null;
    this.config = null;

    this.load();
    this.startBackgroundTasks();
  }

  load() {
    try {
      if (existsSync(this.storagePath)) {
        const content = readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(content);

        Object.entries(data).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
      }
    } catch (error) {
      // Silent fail
    }
  }

  save() {
    try {
      const data = {};
      this.cache.forEach((value, key) => {
        data[key] = value;
      });

      const dir = app.getPath('userData');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
      this.isDirty = false;
      this.emit('saved', data);
    } catch (error) {
      this.emit('error', error);
    }
  }

  get(key) {
    const item = this.cache.get(key);
    return item ? item.data : null;
  }

  set(key, value) {
    this.cache.set(key, {
      data: value,
      updatedAt: new Date().toISOString()
    });
    this.isDirty = true;
    this.emit('changed', { key, value });
    return value;
  }

  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.isDirty = true;
      this.emit('deleted', { key });
    }
    return deleted;
  }

  clear() {
    this.cache.clear();
    this.isDirty = true;
    this.save();
  }

  getAll() {
    const data = {};
    this.cache.forEach((value, key) => {
      data[key] = value;
    });
    return data;
  }

  startBackgroundTasks() {
    this.autoSaveInterval = setInterval(() => {
      if (this.isDirty) {
        this.save();
      }
    }, 60000);
  }

  async syncToCloud() {
    try {
      if (!this.config) {
        const configPath = join(app.getPath('userData'), 'agent-config.json');
        if (existsSync(configPath)) {
          const configContent = readFileSync(configPath, 'utf8');
          this.config = JSON.parse(configContent);
        }
      }

      if (!this.config || !this.config.backendUrl || !this.config.agentId) {
        return;
      }

      const data = this.getAll();

      const response = await axios.post(
        `${this.config.backendUrl}/api/agents/${this.config.agentId}/sync-storage`,
        { storage: data },
        {
          timeout: 5000,
          headers: {
            'Authorization': `Bearer ${this.config.apiKey || this.config.agentToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      // Silent fail
    }
  }

  cleanup() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    if (this.cloudSyncInterval) {
      clearInterval(this.cloudSyncInterval);
    }

    if (this.isDirty) {
      this.save();
    }
  }
}

let storageInstance = null;

export function getStorageManager() {
  if (!storageInstance) {
    storageInstance = new StorageManager();
  }
  return storageInstance;
}

export { StorageManager };