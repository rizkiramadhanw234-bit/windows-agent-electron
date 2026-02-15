param(
    [string]$DataFile = "C:\Scripts\printer-dashboard\data\pages.json",
    [string]$API_URL = "http://localhost:5001/events/print",
    [int]$Interval = 2  
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "      PRINT MONITOR - READY             " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Data: $DataFile" -ForegroundColor White
Write-Host "API: $API_URL" -ForegroundColor White
Write-Host "Interval: ${Interval}s" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Waiting for print jobs..." -ForegroundColor Green
Write-Host ""

# Ensure directory exists
$dataDir = Split-Path $DataFile
if (!(Test-Path $dataDir)) { 
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null 
}

$processedJobs = @{}
$heartbeatTime = Get-Date
$iteration = 0

while ($true) {
    $iteration++
    $currentTime = Get-Date
    
    # Heartbeat log setiap 60 detik
    if (($currentTime - $heartbeatTime).TotalSeconds -ge 60) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Monitor heartbeat - Iteration: $iteration" -ForegroundColor Gray
        $heartbeatTime = $currentTime
    }
    
    try {
        # Cek print jobs dengan error handling
        $jobs = Get-WmiObject Win32_PrintJob -ErrorAction SilentlyContinue
        
        if ($jobs) {
            foreach ($job in $jobs) {
                $jobId = $job.JobId
                $printer = ($job.Name -split ',')[0].Trim()
                $doc = $job.Document
                $status = $job.Status
                
                # Skip fake printers
                if ([string]::IsNullOrWhiteSpace($printer) -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") { 
                    continue 
                }
                
                $jobKey = "$printer|$jobId|$doc"
                
                if ($status -match "Printing" -and -not $processedJobs.ContainsKey($jobKey)) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $doc -> $printer" -ForegroundColor Yellow
                    
                    # Kirim ke API
                    try {
                        $body = @{
                            printer = $printer
                            pages = 1
                            document = $doc
                            timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
                        } | ConvertTo-Json -Compress
                        
                        $response = Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
                        Write-Host "   Sent to API" -ForegroundColor Blue
                    } catch {
                        Write-Host "   API offline" -ForegroundColor Gray
                    }
                    
                    $processedJobs[$jobKey] = Get-Date
                    Start-Sleep -Seconds 1
                }
            }
        }
        
        # Cleanup old jobs
        $cutoffTime = (Get-Date).AddMinutes(-5)
        $oldJobs = $processedJobs.Keys | Where-Object { $processedJobs[$_] -lt $cutoffTime }
        foreach ($key in $oldJobs) {
            $processedJobs.Remove($key)
        }
        
    } catch {
        Write-Host "ERROR: $_" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds $Interval
}