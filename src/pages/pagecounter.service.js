import { runPowerShell } from "../utils/powershell.js";
import { addPages, getDailyReport as getDailyReportFromStore } from "./page.store.js";
import logger from '../utils/logger.js';

let processedJobIdsThisSession = new Set();
let isRunning = false;
let collectionInterval = null;

/**
 * Collect page count from Windows Print Spooler - ENHANCED for WSD printers
 */
async function collectFromPrintSpooler() {
    const today = new Date().toISOString().split('T')[0];

    // ENHANCED SCRIPT: Multiple methods to detect print jobs
    //     const script = `
    // $today = '${today}'
    // $allJobs = @()

    // function Get-AllPrintJobs {
    //     $jobs = @()

    //     # Method 1: Standard Get-PrintJob (works for some printers)
    //     try {
    //         $printers = Get-Printer -ErrorAction SilentlyContinue
    //         foreach ($printer in $printers) {
    //             try {
    //                 $printJobs = Get-PrintJob -PrinterName $printer.Name -ErrorAction SilentlyContinue | 
    //                             Where-Object { 
    //                                 ($_.JobStatus -eq 'Printed' -or $_.JobStatus -eq 'Completed') -and 
    //                                 $_.SubmittedTime.ToString('yyyy-MM-dd') -eq $today 
    //                             }

    //                 foreach ($job in $printJobs) {
    //                     $jobId = "$($printer.Name)-$($job.Id)-$($job.SubmittedTime.ToString('yyyyMMddHHmmss'))"
    //                     $pages = if ($job.PagesPrinted -and $job.PagesPrinted -gt 0) { $job.PagesPrinted } else { 1 }

    //                     $jobs += [PSCustomObject]@{
    //                         JobId = $jobId
    //                         Printer = $printer.Name
    //                         Pages = $pages
    //                         User = if ($job.UserName) { $job.UserName } else { 'Unknown' }
    //                         Computer = if ($job.ComputerName) { $job.ComputerName } else { 'Unknown' }
    //                         Time = $job.SubmittedTime.ToString('HH:mm')
    //                         Document = $job.DocumentName
    //                         Source = 'PrintJob'
    //                     }
    //                 }
    //             } catch {
    //                 # Skip printer errors
    //             }
    //         }
    //     } catch {
    //         # Ignore errors
    //     }

    //     # Method 2: Event Log for WSD printers (like Canon MF642C)
    //     try {
    //         $eventIds = @(307, 10, 20, 301, 302, 306, 308, 316)
    //         $startTime = (Get-Date).AddHours(-24)

    //         $events = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" \`
    //             -FilterXPath "*[System[TimeCreated[@SystemTime >= '$($startTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))']]]" \`
    //             -MaxEvents 100 -ErrorAction SilentlyContinue | 
    //             Where-Object { $_.Id -in $eventIds }

    //         foreach ($e in $events) {
    //             $msg = $e.Message
    //             $printer = $null

    //             # Extract printer name - multiple patterns
    //             if ($msg -match "printer\\s+name:\\s*(.+?)(\\r|\\n|\\.)") {
    //                 $printer = $matches[1].Trim()
    //             } elseif ($msg -match "printed on\\s+(.+?)\\s+through") {
    //                 $printer = $matches[1].Trim()
    //             } elseif ($msg -match "Document\\s+\\d+,\\s+(.+?)\\s+owned by") {
    //                 $printer = $matches[1].Trim()
    //             } elseif ($msg -match "printer\\s*:\\s*(.+?)(\\r|\\n|\\.)") {
    //                 $printer = $matches[1].Trim()
    //             }

    //             # Skip if no printer or fake printer
    //             if (-not $printer -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") {
    //                 continue
    //             }

    //             # Extract pages
    //             $pages = 1
    //             if ($msg -match "Pages printed:\\s*(\\d+)") {
    //                 $pages = [int]$matches[1]
    //             } elseif ($msg -match "Total pages:\\s*(\\d+)") {
    //                 $pages = [int]$matches[1]
    //             } elseif ($msg -match "(\\d+)\\s+pages?") {
    //                 $pages = [int]$matches[1]
    //             }

    //             # Extract document name
    //             $doc = "Print Job"
    //             if ($msg -match "Document\\s+\\d+,\\s+(.+?)\\s+owned by") {
    //                 $doc = $matches[1].Trim()
    //             } elseif ($msg -match "Document name:\\s*(.+?)(\\r|\\n|\\.)") {
    //                 $doc = $matches[1].Trim()
    //             } elseif ($msg -match "file:\\s*(.+?)(\\r|\\n|\\.)") {
    //                 $doc = $matches[1].Trim()
    //             }

    //             # Extract user if available
    //             $user = "Unknown"
    //             if ($msg -match "owned by\\s+(.+?)(\\r|\\n|\\.)") {
    //                 $user = $matches[1].Trim()
    //             }

    //             # Create unique ID for this event
    //             $eventId = "EVT-$($e.RecordId)"

    //             # Only add if from today
    //             if ($e.TimeCreated.ToString('yyyy-MM-dd') -eq $today) {
    //                 $jobs += [PSCustomObject]@{
    //                     JobId = $eventId
    //                     Printer = $printer
    //                     Pages = $pages
    //                     User = $user
    //                     Computer = 'Unknown'
    //                     Time = $e.TimeCreated.ToString('HH:mm')
    //                     Document = $doc
    //                     Source = 'EventLog'
    //                 }
    //             }
    //         }
    //     } catch {
    //         # Ignore event log errors
    //     }

    //     return $jobs | Sort-Object Time -Descending
    // }

    // # Get all jobs using multiple methods
    // $allJobs = Get-AllPrintJobs

    // # Convert to JSON (deduplicate by JobId)
    // $uniqueJobs = $allJobs | Group-Object JobId | ForEach-Object { $_.Group[0] }
    // $uniqueJobs | ConvertTo-Json -Compress
    // `.trim();

    //     try {
    //         const output = await runPowerShell(script);

    //         if (!output || output.trim() === "") {
    //             return { success: true, newJobs: 0, totalPages: 0, jobs: [] };
    //         }

    //         const jobs = JSON.parse(output);
    //         const jobList = Array.isArray(jobs) ? jobs : [jobs];

    //         let newJobs = 0;
    //         let totalPages = 0;
    //         const processedJobs = [];

    //         for (const job of jobList) {
    //             if (!processedJobIdsThisSession.has(job.JobId)) {
    //                 processedJobIdsThisSession.add(job.JobId);
    //                 newJobs++;
    //                 totalPages += job.Pages;

    //                 // Save to persistent store
    //                 await addPages(job.Printer, job.Pages);

    //                 processedJobs.push(job);

    //                 // Special log for Canon printers
    //                 if (job.Printer && job.Printer.match(/(MF642C|MF643C|MF644C|Canon)/i)) {
    //                     logger.info(`📄 [CANON WSD] ${job.Printer}: ${job.Pages} pages - ${job.Document} (via ${job.Source || 'PrintSpooler'})`);
    //                 } else {
    //                     logger.info(`📄 ${job.Printer}: ${job.Pages} pages - ${job.Document} (${job.User})`);
    //                 }
    //             }
    //         }

    //         // Cleanup old cache (keep last 1000)
    //         if (processedJobIdsThisSession.size > 1000) {
    //             const ids = Array.from(processedJobIdsThisSession);
    //             processedJobIdsThisSession = new Set(ids.slice(-500));
    //         }

    //         return {
    //             success: true,
    //             newJobs,
    //             totalPages,
    //             jobs: processedJobs,
    //             message: newJobs > 0 ? `Found ${newJobs} new jobs` : 'No new jobs'
    //         };

    //     } catch (error) {
    //         logger.error(`❌ Print spooler error: ${error.message}`);
    //         return {
    //             success: false,
    //             newJobs: 0,
    //             totalPages: 0,
    //             error: error.message
    //         };
    //     }
    return { success: true, newJobs: 0, totalPages: 0, jobs: [] };
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
            sources: {
                windowsSpooler: {
                    enabled: true,
                    pages: storeReport.totalPages || 0,
                    reliability: "high",
                    note: "Real-time Windows print jobs (supports WSD printers like Canon MF642C)"
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
    logger.info("📊 Method: Windows Print Spooler + Event Log");
    logger.info("📈 Data: Print jobs from THIS PC only (supports WSD printers)");
    logger.info("💾 Storage: Persistent JSON database");
    logger.info("=".repeat(50));

    // Tidak perlu initial collection - page-counter.ps1 yang handle
    logger.info("📭 Collection handled by page-counter.ps1");

    // Interval tetap ada tapi tidak melakukan apa-apa
    collectionInterval = setInterval(() => { }, 30000);

    logger.info("✅ Monitor started (30s interval)");

    return {
        success: true,
        message: "Print Job Monitor started successfully",
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
    return { success: false, message: "Printer SNMP disabled" };
}

export function testPrinterSNMP() {
    logger.info("⚠️ Printer SNMP testing disabled");
    return { success: false, message: "Printer SNMP disabled" };
}