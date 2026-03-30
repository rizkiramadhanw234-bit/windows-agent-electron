param(
    [string]$API_URL = "http://localhost:5001/events/print",
    [int]$CheckInterval = 2
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     PRINTER WATCHER (Event Log)        " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "API: $API_URL" -ForegroundColor White
Write-Host "Interval: ${CheckInterval}s" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Listening for print events..." -ForegroundColor Green
Write-Host ""

$lastRecordId = 0
$heartbeatCount = 0
$lastHeartbeat = Get-Date

# Track processed events to avoid duplicates
$processedEvents = @{}

# Multiple event IDs that might indicate print jobs
$printEventIds = @(307, 10, 20, 301, 302, 306, 308, 316)

# ── Error State Cache (hindari spam kirim error yang sama) ────────────────
$printerErrorCache = @{}
$ERROR_API_URL = "http://localhost:5001/events/printer-error"

# Map WMI DetectedErrorState ke string
$errorStateMap = @{
    3  = "OutOfPaper"
    4  = "OutOfPaper"
    5  = "TonerLow"
    6  = "NoToner"
    7  = "DoorOpen"
    8  = "PaperJam"
    9  = "Offline"
    10 = "UserIntervention"
    11 = "UserIntervention"
}

function Check-PrinterErrors {
    try {
        $printers = Get-WmiObject Win32_Printer -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "OneNote|PDF|Fax|Microsoft|XPS" }

        foreach ($printer in $printers) {
            $errorCode = $printer.DetectedErrorState
            $printerName = $printer.Name

            $errorState = if ($errorStateMap.ContainsKey([int]$errorCode)) {
                $errorStateMap[[int]$errorCode]
            }
            else {
                "NoError"
            }

            $prevError = $printerErrorCache[$printerName]

            # Kirim hanya kalau status berubah
            if ($prevError -ne $errorState) {
                $printerErrorCache[$printerName] = $errorState

                if ($errorState -ne "NoError") {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [ERROR] $printerName : $errorState (code: $errorCode)" -ForegroundColor Red
                }
                else {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [RECOVERED] $printerName : back to normal" -ForegroundColor Green
                }

                try {
                    $body = @{
                        printerName        = $printerName
                        detectedErrorState = $errorState
                        errorCode          = $errorCode
                        printerStatus      = $printer.PrinterStatus
                        timestamp          = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
                    } | ConvertTo-Json -Compress

                    Invoke-RestMethod -Uri $ERROR_API_URL -Method POST `
                        -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
                }
                catch {}
            }
        }
    }
    catch {}
}

while ($true) {
    $heartbeatCount++
    $currentTime = Get-Date
    
    if (($currentTime - $lastHeartbeat).TotalSeconds -ge 60) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Heartbeat" -ForegroundColor Gray
        $lastHeartbeat = $currentTime
        $heartbeatCount = 0
    }
    
    try {
        # Get events with multiple IDs
        $events = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -MaxEvents 20 -ErrorAction SilentlyContinue |
        Where-Object { 
            $_.Id -in $printEventIds -and 
            $_.RecordId -gt $lastRecordId 
        } |
        Sort-Object RecordId

        foreach ($e in $events) {
            $lastRecordId = $e.RecordId
            $msg = $e.Message
            $time = $e.TimeCreated.ToString("HH:mm:ss")
            
            # Skip if already processed
            $eventKey = "$($e.RecordId)-$($e.Id)"
            if ($processedEvents.ContainsKey($eventKey)) {
                continue
            }
            
            $printer = $null
            $pages = 1
            $doc = "Unknown Document"
            
            # Extract printer name - multiple patterns for different event formats
            if ($msg -match "printer\s+name:\s*(.+?)(\r|\n|\.)") {
                $printer = $matches[1].Trim()
            }
            elseif ($msg -match "printed on\s+(.+?)\s+through") {
                $printer = $matches[1].Trim()
            }
            elseif ($msg -match "Document\s+\d+,\s+(.+?)\s+owned by") {
                $printer = $matches[1].Trim()
            }
            elseif ($msg -match "printer\s*:\s*(.+?)(\r|\n|\.)") {
                $printer = $matches[1].Trim()
            }
            elseif ($msg -match "on\s+printer\s+(.+?)(\r|\n|\.)") {
                $printer = $matches[1].Trim()
            }
            
            # Skip fake printers
            if (-not $printer -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") {
                continue
            }
            
            # Extract page count
            if ($msg -match "Pages printed:\s*(\d+)") {
                $pages = [int]$matches[1]
            }
            elseif ($msg -match "Total pages:\s*(\d+)") {
                $pages = [int]$matches[1]
            }
            elseif ($msg -match "(\d+)\s+pages?") {
                $pages = [int]$matches[1]
            }
            elseif ($e.Id -eq 10 -and $msg -match "pages:\s*(\d+)") {
                $pages = [int]$matches[1]
            }
            
            # Extract document name
            if ($msg -match "Document\s+\d+,\s+(.+?)\s+owned by") {
                $doc = $matches[1].Trim()
            }
            elseif ($msg -match "Document name:\s*(.+?)(\r|\n|\.)") {
                $doc = $matches[1].Trim()
            }
            elseif ($msg -match "file:\s*(.+?)(\r|\n|\.)") {
                $doc = $matches[1].Trim()
            }
            elseif ($msg -match "Document\s+(\d+):\s*(.+?)(\r|\n|\.)") {
                $doc = $matches[2].Trim()
            }
            
            # Mark as Canon if detected
            $isCanon = $printer -match "MF642C|MF643C|MF644C|Canon"
            
            if ($isCanon) {
                Write-Host "[$time] [CANON WSD] $printer printed $pages pages (Event ID: $($e.Id))" -ForegroundColor Magenta
            }
            else {
                Write-Host "[$time] $printer printed $pages pages (Event ID: $($e.Id))" -ForegroundColor Yellow
            }
            
            try {
                $body = @{
                    printer   = $printer
                    pages     = $pages
                    document  = $doc
                    timestamp = $e.TimeCreated.ToString("yyyy-MM-ddTHH:mm:ss")
                    source    = "EventLog-$($e.Id)"
                } | ConvertTo-Json -Compress
                
                Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
                Write-Host "   [OK] Sent to API" -ForegroundColor Blue
                
                # Mark as processed
                $processedEvents[$eventKey] = Get-Date
            }
            catch {
                Write-Host "   [OFFLINE] API offline" -ForegroundColor Gray
            }
        }
        
        # Cleanup old processed events (older than 1 hour)
        $oldEvents = @()
        $cutoffTime = (Get-Date).AddHours(-1)
        foreach ($key in $processedEvents.Keys) {
            if ($processedEvents[$key] -lt $cutoffTime) {
                $oldEvents += $key
            }
        }
        foreach ($key in $oldEvents) {
            $processedEvents.Remove($key)
        }
        
    }
    catch {
        Write-Host "Error occurred: $_" -ForegroundColor Red
    }

    # Cek printer errors setiap 10 detik (5 x 2 detik interval)
    if ($heartbeatCount % 5 -eq 0) {
        Check-PrinterErrors
    }
    
    Start-Sleep -Seconds $CheckInterval
}