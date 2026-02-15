import { Service } from 'node-windows';
import { join } from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { app } from 'electron';
import { getDirname } from './esm-utils.js';
import ConfigManager from './config-manager.js';
import { enableAutoStart, disableAutoStart } from './windows-autostart.js';

const __dirname = getDirname(import.meta.url);

function createService(config) {
  const svc = new Service({
    name: 'PrinterDashboardAgent',
    description: 'Printer Monitoring Agent - Auto-sync & Background Service',
    script: join(__dirname, 'agent-service-runner.js'), // ← File baru
    nodeOptions: ['--harmony', '--max_old_space_size=4096'],
    env: [
      {
        name: 'AGENT_CONFIG_PATH',
        value: join(app.getPath('userData'), 'agent-config.json')
      },
      {
        name: 'NODE_ENV',
        value: 'production'
      }
    ],
    workingDirectory: __dirname
  });

  svc.on('install', () => {
    console.log('✅ Service installed successfully');
    svc.start();
  });

  svc.on('start', () => {
    console.log('✅ Service started successfully');
  });

  svc.on('error', (err) => {
    console.error('❌ Service error:', err);
  });

  svc.on('uninstall', () => {
    console.log('✅ Service uninstalled successfully');
  });

  svc.on('alreadyinstalled', () => {
    console.log('⚠️ Service already installed, restarting...');
    svc.restart();
  });

  return svc;
}

async function installAsService(config) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🔧 Installing Windows Service...');
      
      // 1. Save config
      ConfigManager.saveConfig(config);
      console.log('✅ Config saved');

      // 2. Create service runner script
      const serviceRunnerScript = `
// Agent Service Runner - Auto-restart & Monitoring
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const __dirname = path.dirname(__filename);
const logPath = path.join(__dirname, 'logs', 'service.log');

// Ensure log directory
if (!fs.existsSync(path.dirname(logPath))) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = \`[\${timestamp}] \${message}\\n\`;
  console.log(logMessage.trim());
  fs.appendFileSync(logPath, logMessage);
}

function startAgent() {
  log('🚀 Starting Printer Agent...');
  
  const agentProcess = spawn('node', [path.join(__dirname, 'src', 'index.js')], {
    cwd: __dirname,
    stdio: 'inherit',
    windowsHide: true,
    detached: false,
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  });

  agentProcess.on('close', (code) => {
    log(\`⚠️ Agent exited with code \${code}\`);
    
    // Auto-restart setelah 10 detik
    if (code !== 0) {
      log('🔄 Auto-restarting in 10 seconds...');
      setTimeout(() => {
        startAgent();
      }, 10000);
    }
  });

  agentProcess.on('error', (err) => {
    log(\`❌ Failed to start agent: \${err.message}\`);
    setTimeout(() => {
      log('🔄 Retrying...');
      startAgent();
    }, 10000);
  });
  
  return agentProcess;
}

// Start
log('=== Printer Dashboard Agent Service Started ===');
const agent = startAgent();

// Graceful shutdown
process.on('SIGTERM', () => {
  log('📴 Shutting down...');
  agent.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('📴 Shutting down...');
  agent.kill();
  process.exit(0);
});
      `;

      const scriptPath = join(__dirname, 'agent-service-runner.js');
      writeFileSync(scriptPath, serviceRunnerScript, 'utf8');
      console.log('✅ Service runner created');

      // 3. Install service
      const svc = createService(config);
      svc.install();

      // 4. Enable Windows auto-start
      try {
        enableAutoStart();
        console.log('✅ Windows auto-start enabled');
      } catch (err) {
        console.error('⚠️ Failed to enable auto-start:', err.message);
      }

      // 5. Wait for installation
      setTimeout(() => {
        resolve({
          success: true,
          serviceName: 'PrinterDashboardAgent',
          message: 'Service installed. Agent will auto-start on system boot.',
          autoStartEnabled: true
        });
      }, 3000);

    } catch (err) {
      console.error('❌ Service installation failed:', err);
      reject(err);
    }
  });
}

async function uninstallService() {
  return new Promise((resolve, reject) => {
    try {
      console.log('🗑️ Uninstalling Windows Service...');

      const svc = new Service({
        name: 'PrinterDashboardAgent',
        script: join(__dirname, 'agent-service-runner.js')
      });

      svc.on('uninstall', () => {
        console.log('✅ Service uninstalled');
        
        // Remove script
        try {
          const scriptPath = join(__dirname, 'agent-service-runner.js');
          if (existsSync(scriptPath)) {
            unlinkSync(scriptPath);
          }
        } catch (e) {
          console.error('⚠️ Failed to remove script:', e.message);
        }

        // Disable auto-start
        try {
          disableAutoStart();
        } catch (e) {
          console.error('⚠️ Failed to disable auto-start:', e.message);
        }

        resolve({
          success: true,
          message: 'Service uninstalled successfully'
        });
      });

      svc.uninstall();

    } catch (err) {
      reject(err);
    }
  });
}

async function isServiceInstalled() {
  return new Promise((resolve) => {
    try {
      const svc = new Service({
        name: 'PrinterDashboardAgent',
        script: join(__dirname, 'agent-service-runner.js')
      });

      svc.exists((exists) => resolve(exists));
    } catch (err) {
      resolve(false);
    }
  });
}

async function restartService() {
  return new Promise((resolve, reject) => {
    try {
      const svc = new Service({
        name: 'PrinterDashboardAgent',
        script: join(__dirname, 'agent-service-runner.js')
      });

      svc.on('start', () => {
        resolve({
          success: true,
          message: 'Service restarted'
        });
      });

      svc.restart();
    } catch (err) {
      reject(err);
    }
  });
}

export default {
  installAsService,
  uninstallService,
  isServiceInstalled,
  restartService
};