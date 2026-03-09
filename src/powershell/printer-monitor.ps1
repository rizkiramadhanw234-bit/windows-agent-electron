param(
    [string]$DataFile = "C:\Scripts\printer-dashboard\data\pages.json",
    [string]$API_URL = "http://localhost:5001/events/print", 
    [int]$Interval = 2
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "      PRINTER MONITOR (Polling)         " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Data: $DataFile" -ForegroundColor White
Write-Host "API: $API_URL" -ForegroundColor White
Write-Host "Interval: ${Interval}s" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Ensure directory exists
$dataDir = Split-Path $DataFile
if (!(Test-Path $dataDir)) { 
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null 
}

$processedJobs = @{}
$lastEventTime = (Get-Date).AddHours(-1)

function Get-PrintJobsFromWMI {
    $jobs = @()
    try {
        $wmiJobs = Get-WmiObject Win32_PrintJob -ErrorAction SilentlyContinue
        if ($wmiJobs) {
            foreach ($job in $wmiJobs) {
                $printer = ($job.Name -split ',')[0].Trim()
                # Skip fake printers
                if ([string]::IsNullOrWhiteSpace($printer) -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") { 
                    continue 
                }
                
                $jobs += [PSCustomObject]@{
                    Source = "WMI"
                    JobId = $job.JobId
                    Printer = $printer
                    Document = $job.Document
                    Status = $job.Status
                    Time = Get-Date
                    Pages = 1
                }
            }
        }
    } catch {
        # Silent fail
    }
    return $jobs
}

function Get-PrintJobsFromEventLog {
    $jobs = @()
    try {
        # Multiple Event IDs that might indicate print jobs
        $eventIds = @(307, 10, 20, 301, 302, 306, 308, 316)
        $startTime = $lastEventTime
        
        $events = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" `
            -FilterXPath "*[System[TimeCreated[@SystemTime >= '$($startTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))']]]" `
            -MaxEvents 50 -ErrorAction SilentlyContinue | 
            Where-Object { $_.Id -in $eventIds }
        
        foreach ($e in $events) {
            $msg = $e.Message
            $printer = $null
            
            # Extract printer name - multiple patterns
            if ($msg -match "printer\s+name:\s*(.+?)(\r|\n|\.)") {
                $printer = $matches[1].Trim()
            } elseif ($msg -match "printed on\s+(.+?)\s+through") {
                $printer = $matches[1].Trim()
            } elseif ($msg -match "Document\s+\d+,\s+(.+?)\s+owned by") {
                $printer = $matches[1].Trim()
            } elseif ($msg -match "printer\s*:\s*(.+?)(\r|\n|\.)") {
                $printer = $matches[1].Trim()
            }
            
            if (-not $printer -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") {
                continue
            }
            
            # Extract pages
            $pages = 1
            if ($msg -match "Pages printed:\s*(\d+)") {
                $pages = [int]$matches[1]
            } elseif ($msg -match "Total pages:\s*(\d+)") {
                $pages = [int]$matches[1]
            } elseif ($msg -match "(\d+)\s+pages?") {
                $pages = [int]$matches[1]
            }
            
            # Extract document name
            $doc = "Print Job"
            if ($msg -match "Document\s+\d+,\s+(.+?)\s+owned by") {
                $doc = $matches[1].Trim()
            } elseif ($msg -match "Document name:\s*(.+?)(\r|\n|\.)") {
                $doc = $matches[1].Trim()
            } elseif ($msg -match "file:\s*(.+?)(\r|\n|\.)") {
                $doc = $matches[1].Trim()
            }
            
            $jobs += [PSCustomObject]@{
                Source = "EventLog"
                EventId = $e.Id
                Printer = $printer
                Document = $doc
                Pages = $pages
                Time = $e.TimeCreated
                JobId = "EVT_$($e.RecordId)"
            }
            
            # Update last event time
            if ($e.TimeCreated -gt $lastEventTime) {
                $lastEventTime = $e.TimeCreated
            }
        }
    } catch {
        # Silent fail
    }
    return $jobs
}

function Get-PrintJobsFromSpoolerAPI {
    $jobs = @()
    try {
        # Get all printers
        $printers = Get-Printer -ErrorAction SilentlyContinue
        
        foreach ($printer in $printers) {
            try {
                # Use Get-PrintJob which works better with some network printers
                $printJobs = Get-PrintJob -PrinterName $printer.Name -ErrorAction SilentlyContinue | 
                    Where-Object { $_.JobStatus -eq "Printed" -or $_.JobStatus -eq "Completed" }
                
                foreach ($job in $printJobs) {
                    if ($job.SubmittedTime -gt (Get-Date).AddMinutes(-5)) {
                        $jobs += [PSCustomObject]@{
                            Source = "PrintSpoolerAPI"
                            Printer = $printer.Name
                            Document = $job.DocumentName
                            Pages = if ($job.PagesPrinted -gt 0) { $job.PagesPrinted } else { 1 }
                            Time = $job.SubmittedTime
                            JobId = "API_$($printer.Name)_$($job.Id)"
                        }
                    }
                }
            } catch {
                # Skip printer errors
            }
        }
    } catch {
        # Silent fail
    }
    return $jobs
}

function Send-ToAPI {
    param($job)
    
    try {
        $body = @{
            printer = $job.Printer
            pages = $job.Pages
            document = $job.Document
            timestamp = $job.Time.ToString("yyyy-MM-ddTHH:mm:ss")
            source = $job.Source
        } | ConvertTo-Json -Compress
        
        $response = Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        Write-Host "   [OK] Sent to API ($($job.Pages) pages from $($job.Source))" -ForegroundColor Blue
        return $true
    } catch {
        Write-Host "   [OFFLINE] API offline" -ForegroundColor Gray
        return $false
    }
}

# Main loop
Write-Host "Waiting for print jobs..." -ForegroundColor Green
Write-Host ""

while ($true) {
    $time = Get-Date -Format "HH:mm:ss"
    $foundJobs = @()
    
    # Method 1: WMI (original method)
    $wmiJobs = Get-PrintJobsFromWMI
    $foundJobs += $wmiJobs
    
    # Method 2: Event Log (for WSD printers like Canon)
    $eventJobs = Get-PrintJobsFromEventLog
    $foundJobs += $eventJobs
    
    # Method 3: Print Spooler API
    $apiJobs = Get-PrintJobsFromSpoolerAPI
    $foundJobs += $apiJobs
    
    # Process found jobs
    foreach ($job in $foundJobs) {
        $jobKey = "$($job.Printer)|$($job.JobId)|$($job.Document)|$($job.Time.Ticks)"
        
        # Skip if already processed
        if ($processedJobs.ContainsKey($jobKey)) {
            continue
        }
        
        # Check if this is a Canon printer (WSD)
        $isCanonWSD = $job.Printer -match "MF642C|MF643C|MF644C|Canon" -or 
                      ($job.Source -eq "EventLog" -and $job.Printer -match "MF642C|MF643C|MF644C|Canon")
        
        if ($isCanonWSD) {
            Write-Host "[$time] [CANON] $($job.Document) -> $($job.Printer) ($($job.Pages) pages via $($job.Source))" -ForegroundColor Magenta
        } else {
            Write-Host "[$time] $($job.Document) -> $($job.Printer) ($($job.Pages) pages via $($job.Source))" -ForegroundColor Yellow
        }
        
        # Send to API
        if (Send-ToAPI $job) {
            $processedJobs[$jobKey] = Get-Date
        }
    }
    
    # Cleanup old processed jobs (older than 10 minutes)
    $oldJobs = @()
    $cutoffTime = (Get-Date).AddMinutes(-10)
    foreach ($key in $processedJobs.Keys) {
        if ($processedJobs[$key] -lt $cutoffTime) {
            $oldJobs += $key
        }
    }
    foreach ($key in $oldJobs) {
        $processedJobs.Remove($key)
    }
    
    # Limit cache size
    if ($processedJobs.Count -gt 1000) {
        $keysToRemove = $processedJobs.Keys | Sort-Object { $processedJobs[$_] } | Select-Object -First 500
        foreach ($key in $keysToRemove) {
            $processedJobs.Remove($key)
        }
    }
    
    Start-Sleep -Seconds $Interval
}