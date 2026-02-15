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

Write-Host "Waiting for print jobs..." -ForegroundColor Green
Write-Host ""

# Ensure directory exists
$dataDir = Split-Path $DataFile
if (!(Test-Path $dataDir)) { 
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null 
}

$processedJobs = @{}

while ($true) {
    $time = Get-Date -Format "HH:mm:ss"
    
    try {
        # Cek print jobs
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
                
                # Job key untuk tracking
                $jobKey = "$printer|$jobId|$doc"
                
                # KALAU LAGI PRINTING DAN BELUM DIPROSES
                if ($status -match "Printing" -and -not $processedJobs.ContainsKey($jobKey)) {
                    
                    Write-Host "[$time] $doc -> $printer" -ForegroundColor Yellow
                    
                    # Load existing data
                    $data = @{}
                    if (Test-Path $DataFile) {
                        try {
                            $content = Get-Content $DataFile -Raw -Encoding UTF8
                            if ($content.Trim()) {
                                $data = $content | ConvertFrom-Json
                            }
                        } catch {
                            Write-Host "   Could not read JSON" -ForegroundColor Gray
                        }
                    }
                    
                    $today = Get-Date -Format "yyyy-MM-dd"
                    
                    # Ensure structure
                    if (-not $data.$printer) {
                        $data | Add-Member -NotePropertyName $printer -NotePropertyValue @{} -Force
                    }
                    if (-not $data.$printer.$today) {
                        $data.$printer.$today = 0
                    }
                    
                    # Tambah 1 page
                    $data.$printer.$today = $data.$printer.$today + 1
                    $total = $data.$printer.$today
                    
                    # Save to JSON
                    try {
                        $data | ConvertTo-Json -Depth 10 | Out-File $DataFile -Encoding UTF8 -Force
                        Write-Host "   +1 page -> Total today: $total pages" -ForegroundColor Green
                    } catch {
                        Write-Host "   Could not save JSON" -ForegroundColor Gray
                    }
                    
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
                    
                    # Tandai sudah diproses
                    $processedJobs[$jobKey] = Get-Date
                    
                    # Tunggu sebentar biar ga double count
                    Start-Sleep -Seconds 1
                }
            }
        }
        
        # Cleanup old processed jobs (older than 5 minutes)
        $oldJobs = @()
        $cutoffTime = (Get-Date).AddMinutes(-5)
        
        foreach ($key in $processedJobs.Keys) {
            if ($processedJobs[$key] -lt $cutoffTime) {
                $oldJobs += $key
            }
        }
        
        foreach ($key in $oldJobs) {
            $processedJobs.Remove($key)
        }
        
    } catch {
        Write-Host "ERROR: $_" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds $Interval
}