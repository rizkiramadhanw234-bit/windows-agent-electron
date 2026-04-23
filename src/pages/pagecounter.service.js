import { runPowerShell } from "../utils/powershell.js";
import { addPages, getDailyReport as getDailyReportFromStore } from "./page.store.js";
import logger from '../utils/logger.js';

let processedJobIdsThisSession = new Set();
let isRunning = false;
let collectionInterval = null;

async function collectFromPrintSpooler() {
    return { success: true, newJobs: 0, totalPages: 0, jobs: [] };
}

export async function getDailyReportFromPrintJobs(dateStr = null) {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];

    try {
        const storeReport = await getDailyReportFromStore(targetDate);

        const cleanedReport = {
            ...storeReport,
            source: "windows-print-spooler",
            note: "Data collected from Windows Print Spooler (this PC only)",
            recommendation: "Using Windows Print Spooler data (prints from THIS PC only)",
            sources: {
                windowsSpooler: {
                    enabled: true,
                    pages: storeReport.totalPages || 0,
                    reliability: "high",
                    note: "Real-time Windows print jobs (supports WSD printers like Canon MF642C)"
                },
            }
        };

        delete cleanedReport.printerSync;

        return cleanedReport;

    } catch (error) {
        logger.error(`Report error: ${error.message}`);
        return {
            success: false,
            error: error.message,
            date: targetDate,
            totalPages: 0,
            printers: [],
            count: 0,
            timestamp: new Date().toISOString(),
            source: "error-fallback",
            note: "Print Spooler data only"
        };
    }
}

export async function initializePageCounterService() {
    if (isRunning) {
        logger.warn("Monitor already running");
        return { success: false, message: "Already running" };
    }

    isRunning = true;

    logger.info("=".repeat(50));
    logger.info("Print Job Monitor Initialized");
    logger.info("=".repeat(50));
    logger.info("Method: Windows Print Spooler + Event Log");
    logger.info("Data: Print jobs from THIS PC only (supports WSD printers)");
    logger.info("Storage: Persistent JSON database");
    logger.info("=".repeat(50));

    logger.info("Collection handled by page-counter.ps1");

    collectionInterval = setInterval(() => { }, 30000);

    logger.info("Monitor started (30s interval)");

    return {
        success: true,
        message: "Print Job Monitor started successfully",
    };
}

export function stopPageCounterService() {
    if (collectionInterval) {
        clearInterval(collectionInterval);
        collectionInterval = null;
    }

    isRunning = false;

    processedJobIdsThisSession.clear();

    logger.info("Print Job Monitor stopped");
}

export const getConsolidatedDailyReport = getDailyReportFromPrintJobs;
export { collectFromPrintSpooler as collectPageCount };

export function forceRefreshPrinterPages() {
    return { success: false, message: "Printer SNMP disabled" };
}

export function testPrinterSNMP() {
    logger.info("Printer SNMP testing disabled");
    return { success: false, message: "Printer SNMP disabled" };
}