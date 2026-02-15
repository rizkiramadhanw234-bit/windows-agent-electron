import { app } from 'electron';
import { execSync } from 'child_process';

export function enableAutoStart() {
  try {
    const appPath = app.getPath('exe');
    const appName = 'PrinterDashboardAgent';
    
    // Add to Windows Registry (Run on Startup)
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const command = `reg add "${regKey}" /v "${appName}" /t REG_SZ /d "\\"${appPath}\\"" /f`;
    
    execSync(command, { windowsHide: true });
    console.log('✅ Windows auto-start enabled');
    return true;
  } catch (error) {
    console.error('❌ Failed to enable auto-start:', error.message);
    return false;
  }
}

export function disableAutoStart() {
  try {
    const appName = 'PrinterDashboardAgent';
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const command = `reg delete "${regKey}" /v "${appName}" /f`;
    
    execSync(command, { windowsHide: true });
    console.log('✅ Windows auto-start disabled');
    return true;
  } catch (error) {
    console.error('❌ Failed to disable auto-start:', error.message);
    return false;
  }
}

export function isAutoStartEnabled() {
  try {
    const appName = 'PrinterDashboardAgent';
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const command = `reg query "${regKey}" /v "${appName}"`;
    
    execSync(command, { windowsHide: true });
    return true;
  } catch (error) {
    return false;
  }
}