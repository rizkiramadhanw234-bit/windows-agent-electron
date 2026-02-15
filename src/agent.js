import { installWindowsService } from './services/windows.service.js';

const args = process.argv.slice(2);

if (args.includes('--install')) {
  console.log('Installing Printer Monitor Agent as Windows Service...');
  
  installWindowsService({
    name: 'PrinterMonitorAgent',
    description: 'Real-time Printer Monitoring Agent',
    agentId: process.env.AGENT_ID || require('crypto').randomBytes(8).toString('hex')
  }).then(() => {
    console.log('✅ Installation complete!');
    console.log('📝 Service Name: PrinterMonitorAgent');
    console.log('📝 Description: Real-time Printer Monitoring Agent');
    console.log('💡 Run "services.msc" to view and manage the service');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Installation failed:', err);
    process.exit(1);
  });
  
} else if (args.includes('--uninstall')) {
  console.log('Uninstalling Printer Monitor Agent Windows Service...');
  
  const { uninstallWindowsService } = await import('./services/windows.service.js');
  
  uninstallWindowsService('PrinterMonitorAgent').then(() => {
    console.log('✅ Uninstallation complete!');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Uninstallation failed:', err);
    process.exit(1);
  });
  
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📋 Printer Monitor Agent - Usage:
  
  npm start              Start the agent in console mode
  npm run service        Start as Windows Service (requires admin)
  
  --install              Install as Windows Service
  --uninstall           Uninstall Windows Service
  --help, -h            Show this help message
  
📊 Features:
  • Real-time printer monitoring
  • Ink level tracking via SNMP
  • Print job tracking
  • Cloud synchronization
  • Automatic service recovery
  `);
  process.exit(0);
  
} else {
  // Import dan jalankan main app
  console.log('🚀 Starting Printer Monitor Agent in console mode...');
  
  // Tambah handler untuk graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Printer Monitor Agent...');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Terminating Printer Monitor Agent...');
    process.exit(0);
  });
  
  import('./index.js backup').catch(err => {
    console.error('❌ Failed to start application:', err);
    process.exit(1);
  });
}