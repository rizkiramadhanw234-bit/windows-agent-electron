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

while ($true) {
    $heartbeatCount++
    $currentTime = Get-Date
    
    if (($currentTime - $lastHeartbeat).TotalSeconds -ge 60) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Heartbeat" -ForegroundColor Gray
        $lastHeartbeat = $currentTime
        $heartbeatCount = 0
    }
    
    try {
        $events = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -MaxEvents 10 -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -eq 307 -and $_.RecordId -gt $lastRecordId } |
        Sort-Object RecordId

        foreach ($e in $events) {
            $lastRecordId = $e.RecordId
            $msg = $e.Message
            $time = $e.TimeCreated.ToString("HH:mm:ss")
            
            $printer = $null
            if ($msg -match "printed on\s(.+?)\s+through") {
                $printer = $matches[1].Trim()
            } 
            elseif ($msg -match "Document\s+\d+,\s+(.+?)\s+owned by") {
                $printer = $matches[1].Trim()
            }
            
            if (-not $printer -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") {
                continue
            }
            
            $pages = 1
            if ($msg -match "Pages printed:\s*(\d+)") {
                $pages = [int]$matches[1]
            }
            
            Write-Host "[$time] $printer printed $pages pages" -ForegroundColor Yellow
            
            try {
                $body = @{
                    printer  = $printer
                    pages    = $pages
                    document = "From Event Log"
                } | ConvertTo-Json -Compress
                
                Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
                Write-Host "   Sent" -ForegroundColor Blue
            }
            catch {
                Write-Host "   API offline" -ForegroundColor Gray
            }
        }
        
    }
    catch {
        Write-Host "Error occurred" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds $CheckInterval
}