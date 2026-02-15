import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class InstallerConfig {
  constructor() {
    this.appName = 'Printer Dashboard Agent';
    this.appVersion = '1.0.0';
    this.companyName = 'Printer Dashboard';
    this.installPath = join(process.env.ProgramFiles, 'PrinterDashboardAgent');
    this.desktopShortcut = true;
    this.startMenuShortcut = true;
    this.startOnBoot = true;
    this.licenseAccepted = false;
  }

  getDefaultConfig() {
    return {
      appName: this.appName,
      version: this.appVersion,
      installPath: this.installPath,
      createdAt: new Date().toISOString(),
      platform: platform(),
      userDataPath: join(homedir(), 'AppData', 'Roaming', 'PrinterDashboardAgent'),
      shortcuts: {
        desktop: this.desktopShortcut,
        startMenu: this.startMenuShortcut
      },
      autoStart: this.startOnBoot
    };
  }

  async saveInstallConfig(config) {
    try {
      const configDir = join(homedir(), 'AppData', 'Roaming', 'PrinterDashboardAgent');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      const configPath = join(configDir, 'install-config.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      return configPath;
    } catch (error) {
      throw new Error(`Failed to save install config: ${error.message}`);
    }
  }

  async loadInstallConfig() {
    try {
      const configPath = join(homedir(), 'AppData', 'Roaming', 'PrinterDashboardAgent', 'install-config.json');
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf8');
        return JSON.parse(content);
      }
      return null;
    } catch (error) {
      console.error('Error loading install config:', error);
      return null;
    }
  }

  async createDesktopShortcut(targetPath) {
    if (!this.desktopShortcut) return;

    try {
      const desktopPath = join(homedir(), 'Desktop');
      const shortcutPath = join(desktopPath, `${this.appName}.lnk`);
      
      const shortcutScript = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${targetPath}"
oLink.WorkingDirectory = "${this.installPath}"
oLink.Description = "${this.appName}"
oLink.Save
`;
      
      const scriptPath = join(__dirname, 'create-shortcut.vbs');
      writeFileSync(scriptPath, shortcutScript, 'utf8');
      
      await this.executeVBS(scriptPath);
      
      return shortcutPath;
    } catch (error) {
      console.error('Failed to create desktop shortcut:', error);
    }
  }

  async createStartMenuShortcut(targetPath) {
    if (!this.startMenuShortcut) return;

    try {
      const startMenuPath = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      const shortcutPath = join(startMenuPath, `${this.appName}.lnk`);
      
      const shortcutScript = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${targetPath}"
oLink.WorkingDirectory = "${this.installPath}"
oLink.Description = "${this.appName}"
oLink.Save
`;
      
      const scriptPath = join(__dirname, 'create-startmenu.vbs');
      writeFileSync(scriptPath, shortcutScript, 'utf8');
      
      await this.executeVBS(scriptPath);
      
      return shortcutPath;
    } catch (error) {
      console.error('Failed to create start menu shortcut:', error);
    }
  }

  async executeVBS(scriptPath) {
    return new Promise((resolve, reject) => {
      const child = spawn('cscript', [scriptPath, '//Nologo'], {
        stdio: 'pipe',
        windowsHide: true
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`VBS script failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  async configureAutoStart() {
    if (!this.startOnBoot) return;

    try {
      const startupPath = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const shortcutPath = join(startupPath, `${this.appName}.lnk`);
      
      const exePath = join(this.installPath, 'PrinterDashboardAgent.exe');
      
      const shortcutScript = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${exePath}"
oLink.WorkingDirectory = "${this.installPath}"
oLink.Description = "${this.appName} - Auto Start"
oLink.Save
`;
      
      const scriptPath = join(__dirname, 'create-autostart.vbs');
      writeFileSync(scriptPath, shortcutScript, 'utf8');
      
      await this.executeVBS(scriptPath);
      
      return shortcutPath;
    } catch (error) {
      console.error('Failed to configure auto start:', error);
    }
  }

  async uninstall() {
    try {
      // Remove shortcuts
      const desktopPath = join(homedir(), 'Desktop', `${this.appName}.lnk`);
      const startMenuPath = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${this.appName}.lnk`);
      const startupPath = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${this.appName}.lnk`);

      [desktopPath, startMenuPath, startupPath].forEach(path => {
        if (existsSync(path)) {
          try {
            spawn('cmd', ['/c', 'del', `/f`, `/q`, `"${path}"`]);
          } catch (e) {
            console.error(`Failed to remove ${path}:`, e);
          }
        }
      });

      // Remove config
      const configPath = join(homedir(), 'AppData', 'Roaming', 'PrinterDashboardAgent');
      if (existsSync(configPath)) {
        spawn('cmd', ['/c', 'rmdir', `/s`, `/q`, `"${configPath}"`]);
      }

      return true;
    } catch (error) {
      throw new Error(`Uninstall failed: ${error.message}`);
    }
  }
}

export default new InstallerConfig();