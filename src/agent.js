import { installWindowsService } from './services/windows.service.js';

const args = process.argv.slice(2);

if (args.includes('--install')) {
  installWindowsService({
    name: 'PrinterMonitorAgent',
    description: 'Real-time Printer Monitoring Agent',
    agentId: process.env.AGENT_ID || require('crypto').randomBytes(8).toString('hex')
  }).then(() => {
    process.exit(0);
  }).catch(err => {
    process.exit(1);
  });

} else if (args.includes('--uninstall')) {
  const { uninstallWindowsService } = await import('./services/windows.service.js');

  uninstallWindowsService('PrinterMonitorAgent').then(() => {
    process.exit(0);
  }).catch(err => {
    process.exit(1);
  });

} else if (args.includes('--help') || args.includes('-h')) {
  process.exit(0);

} else {
  process.on('SIGINT', () => {
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.exit(0);
  });

  import('./index.js').catch(err => {
    process.exit(1);
  });
}