import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { createRequire } from "module";
import fs from "fs/promises";
import WebSocket from "ws";

// ==================== IMPORTS ====================
import {
    addPages as storeAddPages,
    getDailyReport as getDailyReportFromStore,
    cleanupOldData,
} from "./pages/page.store.js";

import {
    getPrinters,
    getPrintersWithInkStatus,
    refreshPrintersWithInkStatus,
    getCacheStatus,
    clearCache,
} from "./printers/printer.service.js";
import { getPrinterErrors } from "./events/eventlog.service.js";
import { monitorAllPrintersInk, getInkStatus } from "./ink/ink.service.js";

// ==================== PAGE COUNTER SERVICE ====================
import {
    initializePageCounterService,
    getDailyReportFromPrintJobs,
    stopPageCounterService,
    forceRefreshPrinterPages,
} from './pages/pagecounter.service.js';

// ==================== CONFIG ====================
const CONFIG = {
    CLOUD_ENABLED: process.env.CLOUD_ENABLED === "true",
    CLOUD_WS_URL: process.env.CLOUD_WS_URL || "ws://localhost:3001/ws/agent",
    CLOUD_API_KEY: process.env.CLOUD_API_KEY,
    AGENT_TOKEN: process.env.AGENT_TOKEN,
    AGENT_ID: process.env.AGENT_ID || "WINDOWS-PC-001",
    AGENT_NAME: process.env.AGENT_NAME || "Windows Office PC",
    COMPANY_NAME: process.env.COMPANY_NAME || "PT. Kudukuats",
    AGENT_LOCATION: process.env.AGENT_LOCATION || "Jakarta Office",
    HTTP_PORT: process.env.HTTP_PORT || 5001,
    INK_CHECK_INTERVAL: parseInt(process.env.INK_CHECK_INTERVAL) || 30000,
};

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPsPath(file) {
    // ✅ DETEKSI EXE MODE
    const isExe = process.resourcesPath &&
        process.resourcesPath.includes('resources') &&
        !process.resourcesPath.includes('node_modules');

    if (isExe) {
        // ✅ PAKE resourcesPath ASLI!
        const basePath = path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "src",
            "powershell"
        );
        console.log('📦 EXE mode - resourcesPath:', process.resourcesPath);
        console.log('📦 EXE mode - full path:', path.join(basePath, file));
        return path.join(basePath, file);
    }

    // ✅ DEV MODE - pake path dari project root
    const devPath = path.join(process.cwd(), "src", "powershell", file);
    console.log('🖥️ DEV mode - path:', devPath);
    return devPath;
}

// ==================== GLOBAL VARIABLES ====================
let cloudWs = null;
let isCloudConnected = false;
let isShuttingDown = false;
const powerShellProcesses = {
    pageCounter: null,
    printerMonitor: null,
    printerWatcher: null,
};

let server = null;
let cloudReportInterval = null;
let inkCheckInterval = null;

let electronApp = null;

try {
    const { app } = await import("electron");
    electronApp = app;
} catch {
    electronApp = null;
}

// ==================== HTTP SERVER ====================
const app = express();
app.use(cors());
app.use(express.json());

const HTTP_PORT = CONFIG.HTTP_PORT;


async function handlePrintEvent(printerName, pages) {
    console.log(`🖨️ ${printerName} printed ${pages} pages`);

    // Trigger force refresh printer pages
    setTimeout(async () => {
        try {
            await forceRefreshPrinterPages();
            console.log(`✅ Refreshed printer pages after print job`);
        } catch (error) {
            console.log(`⚠️ Failed to refresh printer pages: ${error.message}`);
        }
    }, 2000); // Delay 2 detik biar printer update counter-nya
}

// ==================== GRACEFUL SHUTDOWN ====================

async function cleanupPowerShellProcesses() {
    console.log("🔪 Stopping PowerShell processes...");

    for (const [name, process] of Object.entries(powerShellProcesses)) {
        if (process && !process.killed) {
            console.log(`   Killing ${name} process...`);

            try {
                // Kirim Ctrl+C ke PowerShell
                if (process.stdin && process.stdin.writable) {
                    process.stdin.write('\x03');
                    process.stdin.end();
                }

                // Kill process
                process.kill('SIGTERM');

                // Force kill after 1 second
                setTimeout(() => {
                    if (process && !process.killed) {
                        try {
                            process.kill('SIGKILL');
                            console.log(`   ✓ Force killed ${name}`);
                        } catch (e) {
                            // Ignore
                        }
                    }
                }, 1000);

                console.log(`   ✓ ${name} stopped`);
            } catch (error) {
                console.error(`   Error killing ${name}:`, error.message);
            }
        }
    }
}

function clearAllIntervals() {
    console.log("🔄 Clearing all intervals...");

    if (cloudReportInterval) {
        clearInterval(cloudReportInterval);
        cloudReportInterval = null;
        console.log("   ✓ Cloud report interval cleared");
    }

    if (inkCheckInterval) {
        clearInterval(inkCheckInterval);
        inkCheckInterval = null;
        console.log("   ✓ Ink check interval cleared");
    }

    console.log("   ✓ All intervals cleared");
}

async function closeWebSocket() {
    if (cloudWs && isCloudConnected) {
        console.log('🔌 Closing WebSocket connection...');
        try {
            cloudWs.close();
            console.log('   ✓ WebSocket closed');
        } catch (error) {
            console.error('   WebSocket close error:', error.message);
        }
    }
}

async function closeHttpServer() {
    if (server) {
        console.log('🌐 Closing HTTP server...');
        return new Promise((resolve) => {
            server.close((err) => {
                if (err) {
                    console.error('   HTTP server close error:', err.message);
                } else {
                    console.log('   ✓ HTTP server closed');
                }
                resolve();
            });

            // Force close after 2 seconds
            setTimeout(() => {
                console.log('   ⚠️ HTTP server force closed (timeout)');
                resolve();
            }, 2000);
        });
    }
}

async function gracefulShutdown() {
    if (isShuttingDown) {
        console.log('⚠️ Shutdown already in progress');
        return;
    }

    isShuttingDown = true;

    console.log('\n\n🛑 ======= GRACEFUL SHUTDOWN =======');
    console.log('👋 Stopping Printer Monitor Agent...\n');

    try {
        // 1. Clear all intervals
        clearAllIntervals();

        // 2. Stop page counter service
        console.log("📊 Stopping Print Job Monitor...");
        stopPageCounterService();
        console.log("   ✓ Print Job Monitor stopped");

        // 3. Kill PowerShell processes
        await cleanupPowerShellProcesses();

        // 4. Close WebSocket
        await closeWebSocket();

        // 5. Close HTTP server
        await closeHttpServer();

        // 6. Small delay for cleanup
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('\n✅ Shutdown complete!');
        console.log('=================================\n');

        // Exit process
        setTimeout(() => {
            process.exit(0);
        }, 500);

    } catch (error) {
        console.error('\n❌ Shutdown error:', error);
        console.log('⚠️ Forcing exit...');
        process.exit(1);
    }
}

// Setup shutdown handlers
process.on('SIGINT', async () => {
    console.log('\n📛 Received SIGINT (Ctrl+C)');
    await gracefulShutdown();
});

process.on('SIGTERM', async () => {
    console.log('\n📛 Received SIGTERM');
    await gracefulShutdown();
});

process.on('uncaughtException', (error) => {
    console.error('\n💥 UNCAUGHT EXCEPTION:', error);
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
    gracefulShutdown();
});

// ==================== CLOUD CONNECTION ====================
function connectToCloud() {
    if (!CONFIG.CLOUD_ENABLED || isShuttingDown) {
        console.log("⚠️ Cloud connection disabled");
        return;
    }

    try {
        console.log(`🔗 Connecting to backend: ${CONFIG.CLOUD_WS_URL}`);
        console.log(`🔐 Using Agent Token: ${CONFIG.AGENT_TOKEN?.substring(0, 10)}...`);

        cloudWs = new WebSocket(CONFIG.CLOUD_WS_URL, {
            headers: {
                Authorization: `Bearer ${CONFIG.AGENT_TOKEN}`,
                "X-Agent-ID": CONFIG.AGENT_ID,
            },
        });

        let heartbeatInterval = null;

        cloudWs.on("open", () => {
            console.log("✅ Connected to Backend Server");
            isCloudConnected = true;

            // **PASTIKAN BACKEND MENERIMA TYPE INI!**
            // Coba ganti ke "registration" atau "agent_register" jika "device_register" tidak bekerja
            cloudWs.send(JSON.stringify({
                type: "registration", // ← GANTI JIKA PERLU
                action: "register",
                agentId: CONFIG.AGENT_ID,
                data: {
                    agentId: CONFIG.AGENT_ID,
                    agentName: CONFIG.AGENT_NAME,
                    hostname: require("os").hostname(),
                    platform: process.platform,
                    arch: process.arch,
                    company: CONFIG.COMPANY_NAME,
                    location: CONFIG.AGENT_LOCATION,
                    capability: "print-job-monitoring",
                    timestamp: new Date().toISOString()
                },
            }));
            console.log("📤 Sent registration message to backend");

            // **HEARTBEAT LEBIH CEPAT (5 DETIK)**
            heartbeatInterval = setInterval(() => {
                if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
                    cloudWs.send(JSON.stringify({
                        type: "heartbeat",
                        agentId: CONFIG.AGENT_ID,
                        timestamp: new Date().toISOString(),
                        status: "alive",
                        uptime: process.uptime()
                    }));
                    console.log("❤️ Heartbeat sent");
                }
            }, 5000); // 5 detik
        });

        cloudWs.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log(`📨 Received from backend:`, message); // ← LOG FULL MESSAGE

                if (message.type === "registration_ack" ||
                    message.type === "connection_ack" ||
                    message.type === "welcome") {
                    console.log("✅ Registration acknowledged");
                    sendInitialData();
                }
                else if (message.type === "heartbeat_ack") {
                    console.log("✅ Heartbeat acknowledged");
                }
                else if (message.type === "command") {
                    handleCommand(message);
                }
                else {
                    console.log(`ℹ️ Unknown message type: ${message.type}`);
                }
            } catch (error) {
                console.error("Error parsing backend message:", error);
                console.log("Raw data:", data.toString());
            }
        });

        cloudWs.on("close", (code, reason) => {
            console.log(`🔌 Disconnected from backend - Code: ${code}, Reason: ${reason}`);
            isCloudConnected = false;

            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }

            if (!isShuttingDown) {
                console.log("🔄 Reconnecting in 5 seconds...");
                setTimeout(connectToCloud, 5000);
            }
        });

        cloudWs.on("error", (error) => {
            console.error("WebSocket error:", error);
        });
    } catch (error) {
        console.error("Failed to connect to backend:", error);
        if (!isShuttingDown) {
            console.log("🔄 Retrying in 10 seconds...");
            setTimeout(connectToCloud, 10000);
        }
    }
}

// ==================== SEND DATA TO BACKEND ====================
async function sendInitialData() {
    if (isShuttingDown) return;

    try {
        console.log("📤 Sending initial data to backend...");

        // Send printers
        const printers = await getPrinters();
        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "printer_update",
                    data: { printers },
                    agentId: CONFIG.AGENT_ID,
                }),
            );
            console.log(`📤 Sent ${printers.length} printers to backend`);
        }

        // Send ink status
        const inkStatus = await monitorAllPrintersInk();
        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "ink_status",
                    data: { inkStatus },
                    agentId: CONFIG.AGENT_ID,
                }),
            );
            console.log("📤 Sent ink status to backend");
        }

        // Send daily report
        sendDailyReport();
    } catch (error) {
        console.error("Error sending initial data:", error);
    }
}

async function sendDailyReport() {
    if (isShuttingDown) return;

    try {
        const report = await getDailyReportFromPrintJobs();

        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "daily_report",
                    data: report,
                    agentId: CONFIG.AGENT_ID,
                    timestamp: new Date().toISOString(),
                }),
            );

            console.log(
                `📤 Daily report: ${report.totalPages} pages from ${report.count} printers`,
            );
        }
    } catch (error) {
        console.error("Failed to send daily report:", error);
    }
}

// ==================== HANDLE COMMANDS ====================
function handleCommand(message) {
    const { action, printerName, commandId } = message;

    console.log(`⚡ Command: ${action} for ${printerName}`);

    if (action === "pause_printer") {
        console.log(`⏸️ Pausing printer: ${printerName}`);

        // Send response
        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "command_response",
                    data: {
                        commandId,
                        success: true,
                        message: `Printer ${printerName} paused successfully`,
                    },
                }),
            );
        }
    }

    if (action === "resume_printer") {
        console.log(`▶️ Resuming printer: ${printerName}`);

        // Send response
        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "command_response",
                    data: {
                        commandId,
                        success: true,
                        message: `Printer ${printerName} resumed successfully`,
                    },
                }),
            );
        }
    }
}

// ==================== START MONITORS ====================
async function startAllPrintMonitors() {
    if (isShuttingDown) {
        console.log("⚠️ Skipping monitor start (shutdown in progress)");
        return;
    }

    console.log("🖨️ Starting print monitors...");

    const scripts = [
        {
            name: "page-counter",
            file: "page-counter.ps1",
            description: "Page Counter",
        },
        {
            name: "printer-monitor",
            file: "printer-monitor.ps1",
            description: "Printer Monitor",
        },
        {
            name: "printer-watcher",
            file: "printer-watcher.ps1",
            description: "Printer Watcher",
        },
    ];

    for (const script of scripts) {
        try {
            await startPowerShellScript(script);
            await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`❌ Failed to start ${script.name}:`, error.message);
        }
    }

    console.log("✅ Print monitors started!");
}

async function startPowerShellScript(script) {
    if (isShuttingDown) return null;

    const scriptPath = getPsPath(script.file);

    console.log("🔍 PS Script Path:", scriptPath);

    try {
        await fs.access(scriptPath);
    } catch (error) {
        console.log(`⚠️ ${script.file} not found`);
        return null;
    }
    console.log("🔍 PS Script Path:", scriptPath);
    console.log("📦 isPackaged:", electronApp?.isPackaged);
    console.log("📁 resourcesPath:", process.resourcesPath);
    const psProcess = spawn(
        "powershell.exe",
        ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", scriptPath],
        {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        }
    );

    // Store process reference
    const keyMap = {
        "page-counter": "pageCounter",
        "printer-monitor": "printerMonitor",
        "printer-watcher": "printerWatcher",
    };

    const mappedKey = keyMap[script.name];
    if (mappedKey) {
        powerShellProcesses[mappedKey] = psProcess;
    }


    psProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        if (output && !output.includes("Windows PowerShell")) {
            console.log(`[${script.name}] ${output}`);

            // Detect print events
            if (output.includes("printed") && output.includes("pages")) {
                const match = output.match(/(.+) printed (\d+) pages/);
                if (match && !isShuttingDown) {
                    const [, printerName, pages] = match;
                    const pagesInt = parseInt(pages);

                    console.log(`🖨️ ${printerName.trim()} printed ${pagesInt} pages`);

                    // 1. Trigger real-time refresh printer pages
                    setTimeout(async () => {
                        try {
                            await forceRefreshPrinterPages();
                            console.log(`✅ Refreshed printer pages after print job`);
                        } catch (error) {
                            console.log(`⚠️ Failed to refresh printer pages: ${error.message}`);
                        }
                    }, 2000); // Delay 2 detik

                    // 2. Send to cloud if connected
                    if (cloudWs && isCloudConnected) {
                        cloudWs.send(
                            JSON.stringify({
                                type: "print_event",
                                data: {
                                    printerName: printerName.trim(),
                                    pages: pagesInt,
                                    timestamp: new Date().toISOString(),
                                },
                                agentId: CONFIG.AGENT_ID,
                            }),
                        );
                    }
                }
            }
        }
    });

    psProcess.stderr.on("data", (data) => {
        const error = data.toString().trim();
        if (error && !error.includes("Copyright")) {
            console.error(`[${script.name} Error] ${error}`);
        }
    });

    psProcess.on("close", (code) => {
        console.log(`[${script.name}] exited with code ${code}`);

        if (mappedKey) {
            powerShellProcesses[mappedKey] = null;
        }
        // Auto-restart only if not shutting down
        if (code !== 0 && !isShuttingDown) {
            console.log(`🔄 ${script.name} restarting in 10s...`);
            setTimeout(() => startPowerShellScript(script), 10000);
        }
    });

    psProcess.on("error", (error) => {
        console.error(`[${script.name} Process Error]`, error.message);
        if (mappedKey) {
            powerShellProcesses[mappedKey] = null;
        }
    });

    console.log(`✅ ${script.description} started`);
    return psProcess;
}

// ==================== API ENDPOINTS ====================

// Health check
app.get("/api/health", (req, res) => {
    const monitorsStatus = {
        pageCounter: powerShellProcesses.pageCounter ? "RUNNING" : "STOPPED",
        printerMonitor: powerShellProcesses.printerMonitor ? "RUNNING" : "STOPPED",
        printerWatcher: powerShellProcesses.printerWatcher ? "RUNNING" : "STOPPED",
    };

    res.json({
        success: true,
        agent: "Windows Printer Agent",
        agentId: CONFIG.AGENT_ID,
        uptime: process.uptime(),
        cloudConnected: isCloudConnected,
        monitors: monitorsStatus,
        shutdown: isShuttingDown ? "IN_PROGRESS" : "NO",
        timestamp: new Date().toISOString(),
        endpoints: {
            printers: "/api/printers",
            dailyReport: "/api/report/daily",
            inkStatus: "/api/ink-status",
            health: "/api/printers/health"
        }
    });
});

// Get all printers
app.get("/api/printers", async (req, res) => {
    try {
        const printers = await getPrinters();
        const printersJson = printers.map((printer) => {
            const printerJson = printer.toJSON ? printer.toJSON() : printer;
            return {
                ...printerJson,
                isOnline: printer.status === "READY" || printer.status === "PRINTING",
                isOffline: printer.status === "OFFLINE" || printer.workOffline,
                isPrinting: printer.status === "PRINTING",
            };
        });

        res.json({
            success: true,
            count: printersJson.length,
            printers: printersJson,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Get printers health
app.get("/api/printers/health", async (req, res) => {
    try {
        const printers = await getPrinters();
        const healthReports = printers.map((printer) => ({
            printer: printer.name,
            status: printer.status || "UNKNOWN",
            rawStatus: printer.rawStatus || 0,
            healthStatus: printer.status === "READY" ? "HEALTHY" : "ERROR",
            inkLevels: printer.inkStatus?.levels || {},
            ipAddress: printer.ipAddress,
            vendor: printer.vendor,
            isOnline: printer.status === "READY",
            lastChecked: new Date().toISOString(),
        }));

        res.json({
            success: true,
            printers: healthReports,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Get ink status
app.get("/api/ink-status", async (req, res) => {
    try {
        const inkStatus = await monitorAllPrintersInk();
        res.json({
            success: true,
            inkStatus: inkStatus,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Get daily report
app.get("/api/report/daily", async (req, res) => {
    try {
        const { date } = req.query;
        const report = await getDailyReportFromPrintJobs(date);
        res.json(report);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            date: req.query.date || new Date().toISOString().split('T')[0],
            totalPages: 0,
            printers: []
        });
    }
});

// Manual print event
app.post("/events/print", async (req, res) => {
    try {
        const { printer, pages } = req.body;
        const result = await storeAddPages(printer, pages);

        res.json({
            success: true,
            message: `Added ${pages} pages to ${printer}`,
            data: result,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Get print job details
app.get("/api/print-jobs", async (req, res) => {
    try {
        const { date, printer } = req.query;
        const report = await getDailyReportFromPrintJobs(date);

        // Filter by printer jika ada parameter
        let printers = report.printers;
        if (printer) {
            printers = printers.filter(p => p.name.includes(printer));
        }

        res.json({
            success: true,
            date: report.date,
            totalPages: report.totalPages,
            totalJobs: report.totalJobs,
            printers: printers,
            count: printers.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Debug endpoint
app.get("/api/debug", async (req, res) => {
    try {
        const cacheStatus = await getCacheStatus();

        res.json({
            success: true,
            storeData: storeData,
            cacheStatus: cacheStatus,
            powerShellProcesses: Object.keys(powerShellProcesses).filter(key => powerShellProcesses[key]),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear cache endpoint
app.post("/api/cache/clear", async (req, res) => {
    try {
        await clearCache();
        res.json({
            success: true,
            message: "Cache cleared",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== INITIALIZATION ====================
async function initialize() {
    try {
        console.log("\n" + "=".repeat(60));
        console.log("🚀 WINDOWS PRINTER AGENT");
        console.log("=".repeat(60));
        console.log(`🆔 ${CONFIG.AGENT_ID}`);
        console.log(`📍 ${CONFIG.AGENT_LOCATION}`);
        console.log(`🌐 http://localhost:${HTTP_PORT}`);
        console.log(`☁️ ${CONFIG.CLOUD_ENABLED ? 'ENABLED' : 'DISABLED'}`);
        console.log("=".repeat(60));

        // Cleanup old data
        await cleanupOldData(30);

        // Start Print Job Monitor
        console.log("\n🔄 Starting Print Job Monitor...");
        await initializePageCounterService();
        console.log("✅ Print Job Monitor started");

        // Connect to cloud
        if (CONFIG.CLOUD_ENABLED) {
            console.log("\n☁️ Connecting to cloud...");
            connectToCloud();
        }

        // Start PowerShell monitors
        console.log("\n🖨️ Starting PowerShell monitors...");
        setTimeout(() => {
            if (!isShuttingDown) {
                startAllPrintMonitors();
            }
        }, 2000);

        // Setup periodic tasks
        if (CONFIG.CLOUD_ENABLED) {
            cloudReportInterval = setInterval(() => {
                if (isCloudConnected && !isShuttingDown) {
                    sendDailyReport();
                }
            }, 30000); // 30 seconds
        }

        // Periodic ink check
        inkCheckInterval = setInterval(async () => {
            if (!isShuttingDown) {
                try {
                    await monitorAllPrintersInk();
                } catch (error) {
                    console.error("Ink check error:", error.message);
                }
            }
        }, CONFIG.INK_CHECK_INTERVAL);

        console.log("\n📌 Agent initialized successfully!");
        console.log("📌 Press Ctrl+C to stop\n");

    } catch (error) {
        console.error("\n❌ Initialization error:", error.message);
        console.error("Stack:", error.stack);
        await gracefulShutdown();
    }
}

// Start HTTP server
server = app.listen(HTTP_PORT, () => {
    console.log(`✅ HTTP server listening on port ${HTTP_PORT}`);
});

// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${HTTP_PORT} is already in use!`);
        console.log('💡 Try these solutions:');
        console.log('   1. Kill the process using port 5001:');
        console.log('      netstat -ano | findstr :5001');
        console.log('      taskkill /PID [PID] /F');
        console.log('   2. Change HTTP_PORT in .env file');
        console.log('   3. Wait a few minutes and try again');
        process.exit(1);
    } else {
        console.error('❌ Server error:', error);
        process.exit(1);
    }
});

// Start the agent
initialize();

// Export untuk testing
export { app, server, gracefulShutdown };