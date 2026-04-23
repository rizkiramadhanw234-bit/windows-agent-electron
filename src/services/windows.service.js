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
      service.start();
    });

    service.on('alreadyinstalled', () => {
      resolve();
    });

    service.on('error', (err) => {
      reject(err);
    });

    service.on('start', () => {
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
      resolve();
    });

    service.on('error', (err) => {
      reject(err);
    });

    service.uninstall();
  });
}