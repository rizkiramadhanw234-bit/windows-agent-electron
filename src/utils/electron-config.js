let config = null;

export async function getElectronConfig() {
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      config = await window.electronAPI.getAgentConfig();
      return config;
    } catch (error) {
      console.error('Failed to get config from Electron:', error);
      return null;
    }
  } else if (typeof ipcRenderer !== 'undefined') {
    try {
      config = await ipcRenderer.invoke('get-config');
      return config;
    } catch (error) {
      console.error('Failed to get config via ipcRenderer:', error);
      return null;
    }
  }
  
  return null;
}

export function getConfig() {
  return config;
}

export function isElectron() {
  if (typeof window !== 'undefined' && window.process && window.process.type === 'renderer') {
    return true;
  }
  
  if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes(' electron/')) {
    return true;
  }
  
  return typeof process !== 'undefined' && 
         typeof process.versions === 'object' && 
         !!process.versions.electron;
}

export default { getElectronConfig, getConfig, isElectron };