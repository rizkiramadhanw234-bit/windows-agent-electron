import { runPowerShell } from "../utils/powershell.js";
import { 
    addPages, 
    getDailyReport as getDailyReportFromStore,
    updatePrinterTotalPages,
    getAllPrintersWithTotals
} from "./page.store.js";
import logger from '../utils/logger.js';

let processedJobIdsThisSession = new Set();
let isRunning = false;
let collectionInterval = null;

/**
 * Get printers with IP (for display purposes)
 */
async function getPrintersWithIP() {
    const script = `
$printers = Get-Printer
$results = @()

foreach ($printer in $printers) {
    $printerInfo = @{
        Name = $printer.Name
        PortName = $printer.PortName
        Type = $printer.Type
        Location = $printer.Location
        IP = $null
        Source = "Unknown"
    }
    
    # 1. Check PortName for IP
    if ($printer.PortName -match '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}') {
        $printerInfo.IP = $matches[0]
        $printerInfo.Source = "PortName"
    }
    # 2. Check Location field
    elseif ($printer.Location -and $printer.Location -match '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}') {
        $printerInfo.IP = $matches[0]
        $printerInfo.Source = "Location"
    }
    # 3. WSD printers
    elseif ($printer.PortName -match '^WSD-') {
        $hostname = $printer.Name -replace '\\s*\\(.*\\)', ''
        
        try {
            $ipAddress = [System.Net.Dns]::GetHostAddresses($hostname) | 
                         Where-Object { $_.AddressFamily -eq 'InterNetwork' } | 
                         Select-Object -First 1 -ExpandProperty IPAddressToString
            
            if ($ipAddress) {
                $printerInfo.IP = $ipAddress
                $printerInfo.Source = "WSD-Hostname"
            }
        } catch {
            # Skip jika gagal
        }
    }
    
    if ($printerInfo.IP -and $printerInfo.IP -match '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$') {
        $results += New-Object PSObject -Property $printerInfo
    }
}

if ($results.Count -eq 0) {
    Write-Output "[]"
} else {
    $results | Select-Object Name, IP, PortName, Type, Location, Source | ConvertTo-Json -Compress
}
`.trim();

    try {
        const output = await runPowerShell(script);
        
        if (!output || output.trim() === "" || output.trim() === "[]") {
            return [];
        }
        
        const printers = JSON.parse(output);
        return Array.isArray(printers) ? printers : [printers];
        
    } catch (error) {
        logger.error(`❌ Error getting printers with IP: ${error.message}`);
        return [];
    }
}

/**
 * Collect page count from Windows Print Spooler
 */
export async function collectFromPrintSpooler() {
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
                    $jobId = "$($printer.Name)-$($job.Id)-$($job.SubmittedTime.ToString('yyyyMMddHHmmss'))"
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
                        Time = $job.SubmittedTime.ToString('HH:mm:ss')
                        Document = $job.DocumentName
                        Status = $job.JobStatus
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
                
                // Save to store
                await addPages(job.Printer, job.Pages, "windows-spooler");
                
                processedJobs.push(job);
                
                logger.info(`📄 ${job.Printer}: ${job.Pages} pages - ${job.Document} (${job.User})`);
            }
        }
        
        // Cleanup cache
        if (processedJobIdsThisSession.size > 1000) {
            const ids = Array.from(processedJobIdsThisSession);
            processedJobIdsThisSession = new Set(ids.slice(-500));
        }
        
        return { 
            success: true, 
            newJobs, 
            totalPages, 
            jobs: processedJobs,
            message: newJobs > 0 ? `Found ${newJobs} new print jobs` : 'No new print jobs'
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
 * Update printer total pages from SNMP
 */
async function updateAllPrinterTotals() {
    try {
        const printers = await getPrintersWithIP();
        
        if (printers.length === 0) {
            logger.debug("ℹ️ No printers with IP found for SNMP update");
            return { success: true, updated: 0, printers: [] };
        }
        
        const results = [];
        let updatedCount = 0;
        
        for (const printer of printers) {
            if (printer.IP) {
                try {
                    const result = await updatePrinterTotalPages(printer.Name, printer.IP);
                    
                    if (result.success && result.pagesToday > 0) {
                        updatedCount++;
                        logger.info(`🖨️ ${printer.Name}: ${result.pagesToday} pages from printer counter`);
                    }
                    
                    results.push({
                        printer: printer.Name,
                        ip: printer.IP,
                        success: result.success,
                        pagesToday: result.pagesToday || 0,
                        totalPages: result.totalPages || 0
                    });
                    
                } catch (error) {
                    logger.debug(`⚠️ ${printer.Name}: ${error.message}`);
                    results.push({
                        printer: printer.Name,
                        ip: printer.IP,
                        success: false,
                        error: error.message
                    });
                }
                
                // Delay antara printer untuk avoid overload
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        return {
            success: true,
            updated: updatedCount,
            totalPrinters: printers.length,
            results: results,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        logger.error(`❌ Printer totals update error: ${error.message}`);
        return {
            success: false,
            updated: 0,
            error: error.message
        };
    }
}

/**
 * Get consolidated daily report
 */
export async function getDailyReportFromPrintJobs(dateStr = null) {
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    
    try {
        // Get enhanced report dari store
        const storeReport = await getDailyReportFromStore(targetDate);
        
        // Get printer info untuk display
        const printerInfo = await getPrintersWithIP();
        const printerTotals = await getAllPrintersWithTotals();
        
        return {
            ...storeReport,
            source: "consolidated-report",
            note: "Combined data from Windows Print Spooler and Printer SNMP Counters",
            printerCount: printerInfo.length,
            detectedPrinters: printerInfo,
            printerTotals: printerTotals.printers || [],
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        logger.error(`❌ Consolidated report error: ${error.message}`);
        
        // Fallback
        return {
            success: false,
            error: error.message,
            date: targetDate,
            totalPages: 0,
            printers: [],
            count: 0,
            timestamp: new Date().toISOString(),
            note: "Error generating report"
        };
    }
}

/**
 * Initialize service
 */
export async function initializePageCounterService() {
    if (isRunning) {
        logger.warn("⚠️ Monitor already running");
        return { success: false, message: "Already running" };
    }
    
    isRunning = true;
    
    logger.info("=".repeat(60));
    logger.info("🖨️  PRINT JOB MONITOR - INTEGRATED VERSION");
    logger.info("=".repeat(60));
    logger.info("📊 Method: Windows Spooler + Printer SNMP");
    logger.info("📈 Data: Combined page counting");
    logger.info("🔄 Auto-reset: Daily at midnight");
    logger.info("💾 Storage: Enhanced JSON database");
    logger.info("=".repeat(60));
    
    // Initial collection
    const initialResult = await collectFromPrintSpooler();
    const printerResult = await updateAllPrinterTotals();
    
    if (initialResult.success && initialResult.newJobs > 0) {
        logger.info(`📥 Initial spooler: ${initialResult.newJobs} jobs, ${initialResult.totalPages} pages`);
    }
    
    if (printerResult.success && printerResult.updated > 0) {
        logger.info(`📊 Initial printer counters: ${printerResult.updated} printers updated`);
    }
    
    // Start periodic collection
    collectionInterval = setInterval(async () => {
        try {
            // Collect from Windows spooler (every 30 seconds)
            const spoolerResult = await collectFromPrintSpooler();
            
            // Update printer totals (every 5 minutes)
            const now = Date.now();
            if (now % (5 * 60 * 1000) < 30000) { // Every 5 minutes
                await updateAllPrinterTotals();
            }
            
            if (spoolerResult.success && spoolerResult.newJobs > 0) {
                logger.info(`📥 New: ${spoolerResult.newJobs} jobs, ${spoolerResult.totalPages} pages`);
            }
            
        } catch (error) {
            logger.error(`❌ Collection error: ${error.message}`);
        }
    }, 30000); // 30 seconds
    
    logger.info("✅ Monitor started successfully");
    logger.info("⏰ Spooler check: Every 30 seconds");
    logger.info("⏰ Printer SNMP: Every 5 minutes");
    
    return {
        success: true,
        message: "Integrated Print Job Monitor started",
        method: "combined-spooler-snmp",
        intervals: {
            spooler: "30 seconds",
            printer: "5 minutes"
        },
        features: [
            "windows-print-spooler",
            "printer-snmp-counter",
            "daily-auto-reset",
            "enhanced-storage"
        ]
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
    processedJobIdsThisSession.clear();
    
    logger.info("🛑 Print Job Monitor stopped");
    
    return {
        success: true,
        message: "Monitor stopped",
        timestamp: new Date().toISOString()
    };
}

/**
 * Get service status
 */
export function getServiceStatus() {
    return {
        running: isRunning,
        cacheSize: processedJobIdsThisSession.size,
        interval: collectionInterval ? "active" : "stopped",
        timestamp: new Date().toISOString()
    };
}

// Export untuk backward compatibility
export const getConsolidatedDailyReport = getDailyReportFromPrintJobs;
export { collectFromPrintSpooler as collectPageCount };