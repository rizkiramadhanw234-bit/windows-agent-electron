import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { createRequire } from "module";
import fs from "fs/promises";
import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

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

import {
    initializePageCounterService,
    getDailyReportFromPrintJobs,
    stopPageCounterService,
    forceRefreshPrinterPages,
} from './pages/pagecounter.service.js';

function validateWebsocketUrl(url) {
    if (!url) {
        return null;
    }

    url = url.trim();

    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        return null;
    }

    try {
        const wsUrl = new URL(url);
        return url;
    } catch (error) {
        return null;
    }
}

function parseBackendUrl(input) {
    if (!input) return null;

    if (input.includes(',')) {
        const urls = input.split(',').map(u => u.trim()).filter(u => u);
        return urls[0] || null;
    }

    return input.trim();
}

const CONFIG = {
    CLOUD_ENABLED: process.env.CLOUD_ENABLED === "true",
    CLOUD_WS_URL: validateWebsocketUrl(process.env.CLOUD_WS_URL),
    CLOUD_API_KEY: process.env.CLOUD_API_KEY,
    AGENT_TOKEN: process.env.AGENT_TOKEN,
    AGENT_ID: process.env.AGENT_ID || "WINDOWS-PC-001",
    AGENT_NAME: process.env.AGENT_NAME || "Windows Office PC",
    COMPANY_NAME: process.env.COMPANY_NAME || "PT. Kudukuats",
    AGENT_LOCATION: process.env.AGENT_LOCATION || "Jakarta Office",
    HTTP_PORT: process.env.HTTP_PORT || 5001,
    INK_CHECK_INTERVAL: parseInt(process.env.INK_CHECK_INTERVAL) || 30000,
    BACKEND_URL: parseBackendUrl(process.env.BACKEND_URL),
};

if (CONFIG.CLOUD_ENABLED && !CONFIG.CLOUD_WS_URL) {
    process.exit(1);
}

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPsPath(file) {
    const isExe = process.resourcesPath &&
        process.resourcesPath.includes('resources') &&
        !process.resourcesPath.includes('node_modules');

    if (isExe) {
        const basePath = path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "src",
            "powershell"
        );
        return path.join(basePath, file);
    }

    const devPath = path.join(process.cwd(), "src", "powershell", file);
    return devPath;
}

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
const printerErrorStateCache = {};

let electronApp = null;

try {
    const { app } = await import("electron");
    electronApp = app;
} catch {
    electronApp = null;
}

const app = express();
app.use(cors());
app.use(express.json());

const HTTP_PORT = CONFIG.HTTP_PORT;

async function handlePrintEvent(printerName, pages) {
    setTimeout(async () => {
        try {
            await forceRefreshPrinterPages();
        } catch (error) {
            // Error handled silently
        }
    }, 2000);
}

async function cleanupPowerShellProcesses() {
    for (const [name, process] of Object.entries(powerShellProcesses)) {
        if (process && !process.killed) {
            try {
                if (process.stdin && process.stdin.writable) {
                    process.stdin.write('\x03');
                    process.stdin.end();
                }

                process.kill('SIGTERM');

                setTimeout(() => {
                    if (process && !process.killed) {
                        try {
                            process.kill('SIGKILL');
                        } catch (e) {
                            // Ignore
                        }
                    }
                }, 1000);
            } catch (error) {
                // Error handled silently
            }
        }
    }
}

function clearAllIntervals() {
    if (cloudReportInterval) {
        clearInterval(cloudReportInterval);
        cloudReportInterval = null;
    }

    if (inkCheckInterval) {
        clearInterval(inkCheckInterval);
        inkCheckInterval = null;
    }
}

async function closeWebSocket() {
    if (cloudWs && isCloudConnected) {
        try {
            cloudWs.close();
        } catch (error) {
            // Error handled silently
        }
    }
}

async function closeHttpServer() {
    if (server) {
        return new Promise((resolve) => {
            server.close((err) => {
                resolve();
            });

            setTimeout(() => {
                resolve();
            }, 2000);
        });
    }
}

async function gracefulShutdown() {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;

    try {
        clearAllIntervals();

        stopPageCounterService();

        await cleanupPowerShellProcesses();

        await closeWebSocket();

        await closeHttpServer();

        await new Promise(resolve => setTimeout(resolve, 500));

        setTimeout(() => {
            process.exit(0);
        }, 500);

    } catch (error) {
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    await gracefulShutdown();
});

process.on('SIGTERM', async () => {
    await gracefulShutdown();
});

process.on('uncaughtException', (error) => {
    gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    gracefulShutdown();
});

function connectToCloud() {
    if (!CONFIG.CLOUD_ENABLED || isShuttingDown) {
        return;
    }

    if (!CONFIG.CLOUD_WS_URL) {
        return;
    }

    try {
        cloudWs = new WebSocket(CONFIG.CLOUD_WS_URL, {
            headers: {
                Authorization: `Bearer ${CONFIG.AGENT_TOKEN}`,
                "X-Agent-ID": CONFIG.AGENT_ID,
            },
        });

        let heartbeatInterval = null;

        cloudWs.on("open", () => {
            isCloudConnected = true;

            cloudWs.send(JSON.stringify({
                type: "registration",
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

            setInterval(async () => {
                if (cloudWs && cloudWs.readyState === WebSocket.OPEN && !isShuttingDown) {
                    try {
                        const printers = await getPrintersWithInkStatus();

                        const pagesData = await getDailyReportFromStore();
                        const today = new Date().toISOString().split('T')[0];

                        const enrichedPrinters = printers.map(printer => {
                            let baseName = printer.name;

                            let printerPages = pagesData.printers?.[baseName]?.daily?.[today];

                            if (!printerPages) {
                                printerPages = pagesData.printers?.[printer.name]?.daily?.[today];
                            }

                            return {
                                ...printer.toJSON(),
                                pages_today: printerPages?.windowsSpooler || 0,
                                detectedErrorState: printerErrorStateCache[printer.name] || 'NoError',
                            };
                        });

                        cloudWs.send(JSON.stringify({
                            type: "printer_update",
                            data: { printers: enrichedPrinters },
                            agentId: CONFIG.AGENT_ID,
                            timestamp: new Date().toISOString()
                        }));

                    } catch (err) {
                        // Error handled silently
                    }
                }
            }, 5000);

            heartbeatInterval = setInterval(() => {
                if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
                    cloudWs.send(JSON.stringify({
                        type: "heartbeat",
                        agentId: CONFIG.AGENT_ID,
                        timestamp: new Date().toISOString(),
                        status: "alive",
                        uptime: process.uptime()
                    }));
                }
            }, 5000);
        });

        cloudWs.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === "registration_ack" ||
                    message.type === "connection_ack" ||
                    message.type === "welcome") {
                    sendInitialData();
                }
                else if (message.type === "heartbeat_ack") {
                    // Heartbeat acknowledged
                }
                else if (message.type === "command") {
                    handleCommand(message);
                }
            } catch (error) {
                // Error handled silently
            }
        });

        cloudWs.on("close", (code, reason) => {
            isCloudConnected = false;

            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }

            if (!isShuttingDown) {
                setTimeout(connectToCloud, 5000);
            }
        });

        cloudWs.on("error", (error) => {
            // Error handled silently
        });
    } catch (error) {
        if (!isShuttingDown) {
            setTimeout(connectToCloud, 10000);
        }
    }
}

async function sendInitialData() {
    if (isShuttingDown) return;

    try {
        const printers = await getPrintersWithInkStatus();

        const pagesData = await getDailyReportFromStore();
        const today = new Date().toISOString().split('T')[0];

        const enrichedPrinters = printers.map(printer => {
            const printerPages = pagesData.printers?.[printer.name]?.daily?.[today];
            const printerObj = printer.toJSON ? printer.toJSON() : printer;

            return {
                ...printerObj,
                pages_today: printerPages?.windowsSpooler || 0,
                color_pages_today: printerPages?.colorPages || 0,
                bw_pages_today: printerPages?.bwPages || 0,
            };
        });

        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "printer_update",
                    data: { printers: enrichedPrinters },
                    agentId: CONFIG.AGENT_ID,
                }),
            );
        }

        const inkStatus = await monitorAllPrintersInk();
        if (cloudWs && isCloudConnected) {
            cloudWs.send(
                JSON.stringify({
                    type: "ink_status",
                    data: { inkStatus },
                    agentId: CONFIG.AGENT_ID,
                }),
            );
        }

        sendDailyReport();
    } catch (error) {
        // Error handled silently
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
        }
    } catch (error) {
        // Error handled silently
    }
}

async function handleCommand(message) {
    const { action, printerName, commandId } = message;

    if (action === "pause_printer") {
        const psScript = `
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='${printerName.replace(/'/g, "''")}'"
if ($printer) {
    $printer.Pause()
    Write-Output "PAUSED"
} else {
    Write-Output "NOT_FOUND"
}
`;
        const { runPowerShell } = await import('./utils/powershell.js');

        runPowerShell(psScript).then(result => {
            const success = result.trim() === "PAUSED";

            if (cloudWs && isCloudConnected) {
                cloudWs.send(JSON.stringify({
                    type: "command_response",
                    data: {
                        commandId,
                        success,
                        message: success
                            ? `Printer ${printerName} paused successfully`
                            : `Printer ${printerName} not found`,
                    },
                    agentId: CONFIG.AGENT_ID,
                }));
            }

            if (success && cloudWs && isCloudConnected) {
                cloudWs.send(JSON.stringify({
                    type: "printer_update",
                    data: {
                        printers: [{
                            name: printerName,
                            status: "PAUSED",
                            rawStatus: 6,
                        }]
                    },
                    agentId: CONFIG.AGENT_ID,
                }));
            }
        }).catch(err => {
            // Error handled silently
        });
    }

    if (action === "resume_printer") {
        const psScript = `
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='${printerName.replace(/'/g, "''")}'"
if ($printer) {
    $printer.Resume()
    Write-Output "RESUMED"
} else {
    Write-Output "NOT_FOUND"
}
`;
        const { runPowerShell } = await import('./utils/powershell.js');

        runPowerShell(psScript).then(result => {
            const success = result.trim() === "RESUMED";

            if (cloudWs && isCloudConnected) {
                cloudWs.send(JSON.stringify({
                    type: "command_response",
                    data: {
                        commandId,
                        success,
                        message: success
                            ? `Printer ${printerName} resumed successfully`
                            : `Printer ${printerName} not found`,
                    },
                    agentId: CONFIG.AGENT_ID,
                }));
            }

            if (success && cloudWs && isCloudConnected) {
                cloudWs.send(JSON.stringify({
                    type: "printer_update",
                    data: {
                        printers: [{
                            name: printerName,
                            status: "READY",
                            rawStatus: 3,
                        }]
                    },
                    agentId: CONFIG.AGENT_ID,
                }));
            }
        }).catch(err => {
            // Error handled silently
        });
    }
}

async function startAllPrintMonitors() {
    if (isShuttingDown) {
        return;
    }

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
            // Error handled silently
        }
    }
}

async function startPowerShellScript(script) {
    if (isShuttingDown) return null;

    const scriptPath = getPsPath(script.file);

    try {
        await fs.access(scriptPath);
    } catch (error) {
        return null;
    }

    const psArgs = ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", scriptPath];

    const psProcess = spawn(
        "powershell.exe",
        psArgs,
        {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        }
    );

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
            if (output.includes('[CANON]') && output.includes('pages')) {
                const match = output.match(/-> (.+?) \((\d+) pages/);
                if (match && !isShuttingDown) {
                    const [, printerName, pages] = match;
                    const isColor = output.toUpperCase().includes("COLOR");
                    sendPrintEvent(printerName.trim(), parseInt(pages), isColor);
                }
            }

            if (output.includes('[CANON WSD]') && output.includes('pages -')) {
                const match = output.match(/\[CANON WSD\] (.+?): (\d+) pages/);
                if (match && !isShuttingDown) {
                    const [, printerName, pages] = match;
                    const isColor = output.toUpperCase().includes("COLOR");
                    sendPrintEvent(printerName.trim(), parseInt(pages), isColor);
                }
            }
        }
    });

    psProcess.stderr.on("data", (data) => {
        // Error handled silently
    });

    psProcess.on("close", (code) => {
        if (mappedKey) {
            powerShellProcesses[mappedKey] = null;
        }
        if (code !== 0 && !isShuttingDown) {
            setTimeout(() => startPowerShellScript(script), 10000);
        }
    });

    psProcess.on("error", (error) => {
        if (mappedKey) {
            powerShellProcesses[mappedKey] = null;
        }
    });

    return psProcess;
}

function sendPrintEvent(printerName, pages, isColor = false) {
    setTimeout(async () => {
        try {
            forceRefreshPrinterPages();
        } catch (error) {
            // Error handled silently
        }
    }, 2000);

    if (cloudWs && isCloudConnected) {
        cloudWs.send(JSON.stringify({
            type: "print_event",
            data: {
                printerName: printerName,
                pages: pages,
                isColor: isColor,
                colorPages: isColor ? pages : 0,
                bwPages: isColor ? 0 : pages,
                timestamp: new Date().toISOString(),
            },
            agentId: CONFIG.AGENT_ID,
        }));
    }
}

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
        cloudWsUrl: CONFIG.CLOUD_WS_URL || 'DISABLED',
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

app.post("/events/print", async (req, res) => {
    try {
        const { printer, pages, isColor, colorPages, bwPages, source } = req.body;

        const result = await storeAddPages(printer, pages, {
            isColor: isColor || false,
            colorPages: colorPages || 0,
            bwPages: bwPages !== undefined ? bwPages : (isColor ? 0 : pages)
        });

        if (isColor !== undefined) {
            sendPrintEvent(printer, pages, isColor || false);
        }

        res.json({ success: true, message: `Added ${pages} pages to ${printer}`, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/events/printer-error", async (req, res) => {
    try {
        const { printerName, detectedErrorState, errorCode, printerStatus } = req.body;

        printerErrorStateCache[printerName] = detectedErrorState;

        if (cloudWs && isCloudConnected) {
            cloudWs.send(JSON.stringify({
                type: "printer_update",
                data: {
                    printers: [{
                        name: printerName,
                        detectedErrorState: detectedErrorState || 'NoError',
                        rawStatus: printerStatus || 3,
                        status: detectedErrorState === 'NoError' ? 'READY' : 'ERROR'
                    }]
                },
                agentId: CONFIG.AGENT_ID,
                timestamp: new Date().toISOString()
            }));
        }

        res.json({ success: true, printerName, detectedErrorState });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/api/print-jobs", async (req, res) => {
    try {
        const { date, printer } = req.query;
        const report = await getDailyReportFromPrintJobs(date);

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

app.get("/api/debug", async (req, res) => {
    try {
        const cacheStatus = await getCacheStatus();

        res.json({
            success: true,
            cacheStatus: cacheStatus,
            powerShellProcesses: Object.keys(powerShellProcesses).filter(key => powerShellProcesses[key]),
            cloudConfig: {
                enabled: CONFIG.CLOUD_ENABLED,
                wsUrl: CONFIG.CLOUD_WS_URL,
                agentId: CONFIG.AGENT_ID,
                isConnected: isCloudConnected
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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

async function initialize() {
    try {
        await cleanupOldData(30);

        await initializePageCounterService();

        if (CONFIG.CLOUD_ENABLED) {
            connectToCloud();
        }

        setTimeout(() => {
            if (!isShuttingDown) {
                startAllPrintMonitors();
            }
        }, 2000);

        if (CONFIG.CLOUD_ENABLED) {
            cloudReportInterval = setInterval(() => {
                if (isCloudConnected && !isShuttingDown) {
                    sendDailyReport();
                }
            }, 30000);
        }

        inkCheckInterval = setInterval(async () => {
            if (!isShuttingDown) {
                try {
                    await monitorAllPrintersInk();
                } catch (error) {
                    // Error handled silently
                }
            }
        }, CONFIG.INK_CHECK_INTERVAL);

    } catch (error) {
        await gracefulShutdown();
    }
}

server = app.listen(HTTP_PORT, () => {
    // Server started
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        process.exit(1);
    } else {
        process.exit(1);
    }
});

initialize();

export { app, server, gracefulShutdown, CONFIG };