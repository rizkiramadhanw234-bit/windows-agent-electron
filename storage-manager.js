import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import EventEmitter from 'events';
import axios from 'axios';

class StorageManager extends EventEmitter {
  constructor() {
    super();
    
    // Path storage
    const userDataPath = app.getPath('userData');
    this.storagePath = join(userDataPath, 'agent-storage.json');
    
    this.cache = new Map();
    this.isDirty = false;
    this.autoSaveInterval = null;
    this.cloudSyncInterval = null;
    this.config = null;
    
    console.log('📦 Storage Manager initialized');
    console.log('   Storage path:', this.storagePath);
    
    // Load existing storage
    this.load();
    
    // Start background tasks
    this.startBackgroundTasks();
  }

  // ========== LOAD FROM DISK ==========
  load() {
    try {
      if (existsSync(this.storagePath)) {
        const content = readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(content);
        
        // Load to cache
        Object.entries(data).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        
        console.log(`✅ Storage loaded: ${this.cache.size} items`);
      } else {
        console.log('📁 No existing storage, starting fresh');
      }
    } catch (error) {
      console.error('❌ Failed to load storage:', error);
    }
  }

  // ========== SAVE TO DISK ==========
  save() {
    try {
      const data = {};
      this.cache.forEach((value, key) => {
        data[key] = value;
      });
      
      // Ensure directory exists
      const dir = app.getPath('userData');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
      this.isDirty = false;
      this.emit('saved', data);
      
      console.log(`💾 Storage saved: ${Object.keys(data).length} items`);
    } catch (error) {
      console.error('❌ Failed to save storage:', error);
      this.emit('error', error);
    }
  }

  // ========== CRUD OPERATIONS ==========
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

  // ========== BACKGROUND TASKS ==========
  startBackgroundTasks() {
    // Auto-save setiap 10 detik jika ada perubahan
    this.autoSaveInterval = setInterval(() => {
      if (this.isDirty) {
        console.log('🔄 Auto-saving storage...');
        this.save();
      }
    }, 10000);

    // Cloud sync setiap 30 detik
    // this.cloudSyncInterval = setInterval(() => {
    //   this.syncToCloud();
    // }, 30000);

    console.log('🚀 Background tasks started');
    console.log('   - Auto-save: every 10s');
    console.log('   - Cloud sync: DISABLED (using WebSocket real-time sync)');
  }

  // ========== CLOUD SYNC ==========
  async syncToCloud() {
    try {
      // Load config dynamically dari file
      if (!this.config) {
        const configPath = join(app.getPath('userData'), 'agent-config.json');
        if (existsSync(configPath)) {
          const configContent = readFileSync(configPath, 'utf8');
          this.config = JSON.parse(configContent);
        }
      }

      if (!this.config || !this.config.backendUrl || !this.config.agentId) {
        // Silent skip - config belum ada
        return;
      }

      const data = this.getAll();
      
      // Kirim ke backend
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

      if (response.data.success) {
        console.log('☁️ Storage synced to cloud');
        this.emit('cloud-synced', { timestamp: new Date().toISOString() });
      }

    } catch (error) {
      // Silent fail untuk cloud sync
      if (error.code !== 'ECONNREFUSED' && error.code !== 'ENOTFOUND') {
        console.error('Cloud sync error:', error.message);
      }
    }
  }

  // ========== CLEANUP ==========
  cleanup() {
    console.log('🧹 Cleaning up storage manager...');
    
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    if (this.cloudSyncInterval) {
      clearInterval(this.cloudSyncInterval);
    }
    
    // Final save
    if (this.isDirty) {
      this.save();
    }
    
    console.log('✅ Storage cleanup complete');
  }
}

// Singleton instance
let storageInstance = null;

export function getStorageManager() {
  if (!storageInstance) {
    storageInstance = new StorageManager();
  }
  return storageInstance;
}

export { StorageManager };