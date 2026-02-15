// service.js - Service entry point
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting Printer Agent Service...');

// Load config
const configPath = join(__dirname, 'agent-config.json');
let config = {};

if (existsSync(configPath)) {
    try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
        console.log('📋 Config loaded:', config.agentId);
    } catch (err) {
        console.error('Failed to load config:', err);
    }
}

// Start agent process
function startAgent() {
    console.log('▶️ Starting agent process...');
    
    const agentProcess = spawn('node', ['src/index.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        windowsHide: true,
        detached: false
    });
    
    agentProcess.on('close', (code) => {
        console.log(`Agent process exited with code ${code}`);
        if (code !== 0) {
            console.log('🔄 Restarting in 10 seconds...');
            setTimeout(startAgent, 10000);
        }
    });
    
    agentProcess.on('error', (err) => {
        console.error('Failed to start agent:', err);
        console.log('🔄 Retrying in 10 seconds...');
        setTimeout(startAgent, 10000);
    });
    
    // Handle service stop signal
    process.on('SIGTERM', () => {
        console.log('Received SIGTERM, stopping agent...');
        if (agentProcess && !agentProcess.killed) {
            agentProcess.kill('SIGTERM');
        }
        process.exit(0);
    });
}

// Start
startAgent();