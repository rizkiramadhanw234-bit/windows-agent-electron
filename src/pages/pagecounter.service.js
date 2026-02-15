import { runPowerShell } from "../utils/powershell.js";
import { addPages, getDailyReport as getDailyReportFromStore } from "./page.store.js";
import logger from '../utils/logger.js';

let processedJobIdsThisSession = new Set();
let isRunning = false;
let collectionInterval = null;

/**
 * Collect page count from Windows Print Spooler (ONLY METHOD)
 */
async function collectFromPrintSpooler() {
    const today = new Date().toISOString().split('T')[0];

    const script = `
$today = '${today}'
$allJobs = @()

try {
    $printers = Get-Printer -ErrorAction SilentlyContinue
    
    foreach ($printer in $printers) {
        try {
            $jobs = Get-PrintJob -PrinterName $printer.Name -ErrorAction SilentlyContinue | 
                    Where-Object { 
                        ($_.JobStatus -eq 'Printed' -or $_.JobStatus -eq 'Completed') -and 
                        $_.SubmittedTime.ToString('yyyy-MM-dd') -eq $today 
                    }
            
            if ($jobs) {
                foreach ($job in $jobs) {
                    # Create unique job ID
                    $jobId = "$($printer.Name)-$($job.Id)-$($job.SubmittedTime.ToString('yyyyMMddHHmmss'))"
                    
                    # Calculate pages (use PagesPrinted if available, else default to 1)
                    $pages = if ($job.PagesPrinted -and $job.PagesPrinted -gt 0) { 
                        $job.PagesPrinted 
                    } else { 
                        1 
                    }
                    
                    $allJobs += [PSCustomObject]@{
                        JobId = $jobId
                        Printer = $printer.Name
                        Pages = $pages
                        User = if ($job.UserName) { $job.UserName } else { 'Unknown' }
                        Computer = if ($job.ComputerName) { $job.ComputerName } else { 'Unknown' }
                        Time = $job.SubmittedTime.ToString('HH:mm')
                        Document = $job.DocumentName
                    }
                }
            }
        } catch {
            # Skip printer errors
        }
    }
} catch {
    # Ignore global errors
}

$allJobs | Sort-Object Time -Descending | ConvertTo-Json -Compress
`.trim();

    try {
        const output = await runPowerShell(script);

        if (!output || output.trim() === "") {
            return { success: true, newJobs: 0, totalPages: 0, jobs: [] };
        }

        const jobs = JSON.parse(output);
        const jobList = Array.isArray(jobs) ? jobs : [jobs];

        let newJobs = 0;
        let totalPages = 0;
        const processedJobs = [];

        for (const job of jobList) {
            if (!processedJobIdsThisSession.has(job.JobId)) {
                processedJobIdsThisSession.add(job.JobId);
                newJobs++;
                totalPages += job.Pages;

                // Save to persistent store
                await addPages(job.Printer, job.Pages);

                processedJobs.push(job);

                logger.info(`📄 ${job.Printer}: ${job.Pages} pages - ${job.Document} (${job.User})`);
            }
        }

        // Cleanup old cache (keep last 1000)
        if (processedJobIdsThisSession.size > 1000) {
            const ids = Array.from(processedJobIdsThisSession);
            processedJobIdsThisSession = new Set(ids.slice(-500));
        }

        return {
            success: true,
            newJobs,
            totalPages,
            jobs: processedJobs,
            message: newJobs > 0 ? `Found ${newJobs} new jobs` : 'No new jobs'
        };

    } catch (error) {
        logger.error(`❌ Print spooler error: ${error.message}`);
        return {
            success: false,
            newJobs: 0,
            totalPages: 0,
            error: error.message
        };
    }
}

/**
 * Get daily report - SIMPLE VERSION (Print Spooler only)
 */
export async function getDailyReportFromPrintJobs(dateStr = null) {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];

    try {
        // Get report dari store (hanya data dari Print Spooler)
        const storeReport = await getDailyReportFromStore(targetDate);

        // Remove printer SNMP data from response
        const cleanedReport = {
            ...storeReport,
            source: "windows-print-spooler",
            note: "Data collected from Windows Print Spooler (this PC only)",
            recommendation: "Using Windows Print Spooler data (prints from THIS PC only)",
            // Hapus semua reference ke printer SNMP
            // printerPages: 0,
            sources: {
                windowsSpooler: {
                    enabled: true,
                    pages: storeReport.totalPages || 0,
                    reliability: "high",
                    note: "Real-time Windows print jobs"
                },
            }
        };

        // Hapus printerSync jika ada
        delete cleanedReport.printerSync;

        return cleanedReport;

    } catch (error) {
        logger.error(`❌ Report error: ${error.message}`);
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

/**
 * Initialize service - SIMPLE VERSION (Print Spooler only)
 */
export async function initializePageCounterService() {
    if (isRunning) {
        logger.warn("⚠️ Monitor already running");
        return { success: false, message: "Already running" };
    }

    isRunning = true;

    logger.info("=".repeat(50));
    logger.info("🖨️  Print Job Monitor Initialized");
    logger.info("=".repeat(50));
    logger.info("📊 Method: Windows Print Spooler Monitoring");
    logger.info("📈 Data: Print jobs from THIS PC only");
    logger.info("💾 Storage: Persistent JSON database");
    logger.info("=".repeat(50));

    // Initial collection
    const initialResult = await collectFromPrintSpooler();

    if (initialResult.success && initialResult.newJobs > 0) {
        logger.info(`📥 Initial: ${initialResult.newJobs} jobs, ${initialResult.totalPages} pages`);
    } else {
        logger.info("📭 No new jobs found");
    }

    // Start periodic collection (every 30 seconds)
    collectionInterval = setInterval(async () => {
        try {
            const result = await collectFromPrintSpooler();
            if (result.success && result.newJobs > 0) {
                logger.info(`📥 New: ${result.newJobs} jobs, ${result.totalPages} pages`);
            }
        } catch (error) {
            logger.error(`❌ Collection error: ${error.message}`);
        }
    }, 30000);

    logger.info("✅ Monitor started (30s interval)");

    return {
        success: true,
        message: "Print Job Monitor started successfully",
        method: "windows-print-spooler",
        interval: "30 seconds"
    };
}

/**
 * Stop monitoring service
 */
export function stopPageCounterService() {
    if (collectionInterval) {
        clearInterval(collectionInterval);
        collectionInterval = null;
    }

    isRunning = false;

    // Clear cache
    processedJobIdsThisSession.clear();

    logger.info("🛑 Print Job Monitor stopped");
}

// Export untuk backward compatibility
export const getConsolidatedDailyReport = getDailyReportFromPrintJobs;
export { collectFromPrintSpooler as collectPageCount };

// No SNMP functions
export function forceRefreshPrinterPages() {
    // logger.info("⚠️ Printer SNMP refresh disabled");
    return { success: false, message: "Printer SNMP disabled" };
}

export function testPrinterSNMP() {
    logger.info("⚠️ Printer SNMP testing disabled");
    return { success: false, message: "Printer SNMP disabled" };
}