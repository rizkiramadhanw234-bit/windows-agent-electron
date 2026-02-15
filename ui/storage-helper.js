// Storage Helper untuk Renderer Process
console.log('📦 Storage Helper loaded');

class StorageHelper {
  constructor() {
    this.listeners = new Map();
    
    // Setup IPC listeners
    if (window.ipcRenderer) {
      window.ipcRenderer.on('storage:changed', (event, data) => {
        console.log('📝 Storage changed:', data);
        this.listeners.forEach(callback => callback(data));
      });
      
      window.ipcRenderer.on('storage:cloud-synced', (event, data) => {
        console.log('☁️ Cloud synced:', data);
        this.onCloudSyncCallbacks.forEach(callback => callback(data));
      });
    }
    
    this.onCloudSyncCallbacks = new Set();
  }

  async get(key) {
    if (!window.ipcRenderer) return null;
    try {
      return await window.ipcRenderer.invoke('storage:get', key);
    } catch (error) {
      console.error('Storage get error:', error);
      return null;
    }
  }

  async set(key, value) {
    if (!window.ipcRenderer) return false;
    try {
      const result = await window.ipcRenderer.invoke('storage:set', key, value);
      return result.success;
    } catch (error) {
      console.error('Storage set error:', error);
      return false;
    }
  }

  async delete(key) {
    if (!window.ipcRenderer) return false;
    try {
      const result = await window.ipcRenderer.invoke('storage:delete', key);
      return result.success;
    } catch (error) {
      console.error('Storage delete error:', error);
      return false;
    }
  }

  async getAll() {
    if (!window.ipcRenderer) return {};
    try {
      return await window.ipcRenderer.invoke('storage:getAll');
    } catch (error) {
      console.error('Storage getAll error:', error);
      return {};
    }
  }

  async clear() {
    if (!window.ipcRenderer) return false;
    try {
      const result = await window.ipcRenderer.invoke('storage:clear');
      return result.success;
    } catch (error) {
      console.error('Storage clear error:', error);
      return false;
    }
  }

  // Event listeners
  onChange(callback) {
    const id = Date.now();
    this.listeners.set(id, callback);
    return () => this.listeners.delete(id);
  }

  onCloudSync(callback) {
    this.onCloudSyncCallbacks.add(callback);
    return () => this.onCloudSyncCallbacks.delete(callback);
  }
}

// Export singleton
window.storage = new StorageHelper();
console.log('✅ Storage helper ready');