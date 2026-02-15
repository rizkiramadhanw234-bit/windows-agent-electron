import { Service } from 'node-windows';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function installWindowsService(options = {}) {
  const service = new Service({
    name: options.name || 'PrinterMonitorAgent',
    description: options.description || 'Real-time Printer Monitoring Agent',
    script: path.join(__dirname, '../index.js'),
    nodeOptions: [
      '--harmony',
      '--max_old_space_size=4096'
    ],
    env: [
      {
        name: 'NODE_ENV',
        value: 'production'
      },
      {
        name: 'AGENT_ID',
        value: options.agentId || require('crypto').randomBytes(8).toString('hex')
      }
    ],
    ...options
  });

  return new Promise((resolve, reject) => {
    service.on('install', () => {
      console.log('✅ Service installed successfully');
      service.start();
    });

    service.on('alreadyinstalled', () => {
      console.log('ℹ️ Service already installed');
      resolve();
    });

    service.on('error', (err) => {
      console.error('❌ Service installation error:', err);
      reject(err);
    });

    service.on('start', () => {
      console.log('🚀 Service started');
      resolve();
    });

    service.install();
  });
}

export function uninstallWindowsService(serviceName = 'PrinterMonitorAgent') {
  const service = new Service({
    name: serviceName,
    script: path.join(__dirname, '../index.js')
  });

  return new Promise((resolve, reject) => {
    service.on('uninstall', () => {
      console.log('✅ Service uninstalled successfully');
      resolve();
    });

    service.on('error', (err) => {
      console.error('❌ Service uninstall error:', err);
      reject(err);
    });

    service.uninstall();
  });
}