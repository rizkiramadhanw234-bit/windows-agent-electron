param(
    [string]$API_URL = "http://localhost:5001/events/print",
    [int]$Interval = 2  
)

# if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
#     Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -API_URL `"$API_URL`" -Interval $Interval"
#     exit
# }

try {
    $logConfig = New-Object System.Diagnostics.Eventing.Reader.EventLogConfiguration "Microsoft-Windows-PrintService/Operational"
    if (-not $logConfig.IsEnabled) {
        $logConfig.IsEnabled = $true
        $logConfig.SaveChanges()
        Write-Host "[AUTO-FIX] PrintService log enabled!" -ForegroundColor Green
        Start-Sleep -Seconds 2
    }
}
catch { Write-Host "[WARN] Could not enable log: $_" -ForegroundColor Red }

try {
    $adminLog = New-Object System.Diagnostics.Eventing.Reader.EventLogConfiguration "Microsoft-Windows-PrintService/Admin"
    if (-not $adminLog.IsEnabled) { $adminLog.IsEnabled = $true; $adminLog.SaveChanges() }
}
catch {}

$winBuild = [System.Environment]::OSVersion.Version.Build
$isWin11 = ($winBuild -ge 22000)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "      PRINT MONITOR - READY             " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OS Build: $winBuild $(if($isWin11){'(Win11)'}else{'(Win10)'})" -ForegroundColor White
Write-Host "API: $API_URL" -ForegroundColor White
Write-Host "Interval: ${Interval}s" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Waiting for print jobs..." -ForegroundColor Green
Write-Host ""

$processedJobs = @{}
$heartbeatTime = Get-Date
$iteration = 0
$lastRecordId = 0
$eventLogWorks = $true

# Cache IP per printer name
$printerIPCache = @{}

# Cache counter per printer IP { color, mono }
$printerCounterCache = @{}
$jobColorCache = @{}

try {
    $latest = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -MaxEvents 1 -ErrorAction SilentlyContinue
    if ($latest) { $lastRecordId = $latest.RecordId }
}
catch { $eventLogWorks = $false }

# ── Resolve IP dari nama printer via registry WSD ─────────────────────────
function Get-PrinterIP {
    param($printerName)

    # Cek cache dulu
    if ($printerIPCache.ContainsKey($printerName)) {
        return $printerIPCache[$printerName]
    }

    $ip = $null

    # Method 1: Registry WSD (WSD port - paling umum untuk network printer)
    try {
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\SWD\DAFWSDProvider"
        $entries = Get-ChildItem $regPath -ErrorAction SilentlyContinue
        foreach ($entry in $entries) {
            $props = Get-ItemProperty $entry.PSPath -ErrorAction SilentlyContinue
            if ($props.FriendlyName -eq $printerName) {
                $location = $props.LocationInformation
                if ($location -match "http://(\d+\.\d+\.\d+\.\d+)") {
                    $ip = $matches[1]
                    break
                }
            }
        }
    }
    catch {}

    # Method 2: Standard TCP/IP port
    if (-not $ip) {
        try {
            $printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
            if ($printer) {
                $port = Get-PrinterPort -Name $printer.PortName -ErrorAction SilentlyContinue
                if ($port.PrinterHostAddress) { $ip = $port.PrinterHostAddress }
            }
        }
        catch {}
    }

    # Method 3: DNS resolve dari hostname (ambil bagian pertama nama printer)
    if (-not $ip) {
        try {
            $hostname = ($printerName -split ' ')[0].Trim()
            $addresses = [System.Net.Dns]::GetHostAddresses($hostname) | 
            Where-Object { $_.AddressFamily -eq "InterNetwork" }
            if ($addresses) { $ip = $addresses[0].IPAddressToString }
        }
        catch {}
    }

    if ($ip) {
        $printerIPCache[$printerName] = $ip
        Write-Host "   [IP] $printerName → $ip" -ForegroundColor DarkGray
    }

    return $ip
}

# ── Fetch counter color/mono dari web interface printer ───────────────────
function Get-PrinterCounters {
    param($ip, $printerName)

    if (-not $ip) { return $null }

    # Deteksi brand dari nama printer
    $brand = "unknown"
    if ($printerName -match "HP|LaserJet|OfficeJet|DeskJet|PageWide") { $brand = "hp" }
    elseif ($printerName -match "Canon|MF|LBP|imageRUNNER|PIXMA") { $brand = "canon" }
    elseif ($printerName -match "Epson|ET-|WF-|L\d{3,4}") { $brand = "epson" }
    elseif ($printerName -match "Brother|HL-|MFC-|DCP-") { $brand = "brother" }

    $counters = $null

    switch ($brand) {
        "hp" {
            try {
                $resp = Invoke-WebRequest -Uri "http://$ip/DevMgmt/ProductUsageDyn.xml" `
                    -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
                $xml = [xml]$resp.Content
                $sub = $xml.ProductUsageDyn.PrinterSubunit
                $counters = @{
                    color = [int]$sub.ColorImpressions
                    mono  = [int]$sub.MonochromeImpressions
                    total = [int]$sub.TotalImpressions
                }
            }
            catch {}
        }
        "canon" {
            # Canon iR/MF series - coba beberapa URL
            $canonURLs = @(
                "/DevMgmt/ProductUsageDyn.xml",
                "/hnm/counter.xml",
                "/portal/basicinfo.html"
            )
            foreach ($url in $canonURLs) {
                try {
                    $resp = Invoke-WebRequest -Uri "http://$ip$url" `
                        -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
                    # Parse XML Canon
                    if ($resp.Content -match "ColorCounter|colorCounter|color_counter") {
                        $xml = [xml]$resp.Content
                        # Canon biasanya: ColorPageCount / MonoPageCount
                        $colorNode = $xml.SelectSingleNode("//*[local-name()='ColorPageCount' or local-name()='colorCounter']")
                        $monoNode = $xml.SelectSingleNode("//*[local-name()='MonoPageCount' or local-name()='monoCounter']")
                        if ($colorNode -and $monoNode) {
                            $counters = @{
                                color = [int]$colorNode.InnerText
                                mono  = [int]$monoNode.InnerText
                                total = [int]$colorNode.InnerText + [int]$monoNode.InnerText
                            }
                            break
                        }
                    }
                }
                catch {}
            }
        }
        "epson" {
            try {
                $resp = Invoke-WebRequest -Uri "http://$ip/PRESENTATION/HTML/TOP/INDEX.HTM" `
                    -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
                # Epson biasanya di /cgi-bin/home atau /info
                if ($resp.Content -match "ColorPage|colorpage") {
                    if ($resp.Content -match "ColorPage[^\d]*(\d+)") { $colorCount = [int]$matches[1] }
                    if ($resp.Content -match "MonoPage[^\d]*(\d+)") { $monoCount = [int]$matches[1] }
                    if ($colorCount -ne $null) {
                        $counters = @{ color = $colorCount; mono = $monoCount; total = $colorCount + $monoCount }
                    }
                }
            }
            catch {}
        }
        "brother" {
            try {
                $resp = Invoke-WebRequest -Uri "http://$ip/general/information.html" `
                    -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
                if ($resp.Content -match "Full Colour[^\d]*(\d+)") { $colorCount = [int]$matches[1] }
                if ($resp.Content -match "Black &amp; White[^\d]*(\d+)") { $monoCount = [int]$matches[1] }
                if ($colorCount -ne $null) {
                    $counters = @{ color = $colorCount; mono = $monoCount; total = $colorCount + $monoCount }
                }
            }
            catch {}
        }
    }

    return $counters
}

# ── Detect color via counter diff ─────────────────────────────────────────
function Detect-IsColorViaCounter {
    param($printerName, $pages)

    $ip = Get-PrinterIP $printerName
    if (-not $ip) { return $null }

    # Kalau belum ada cache, ambil sekarang dan simpan
    if (-not $printerCounterCache.ContainsKey($printerName)) {
        $current = Get-PrinterCounters $ip $printerName
        if ($current) { $printerCounterCache[$printerName] = $current }
        return $null
    }

    $prev = $printerCounterCache[$printerName]

    # Retry sampai 3x (max 9 detik) tunggu printer update counter-nya
    $current = $null
    for ($i = 1; $i -le 3; $i++) {
        Start-Sleep -Seconds 3
        $current = Get-PrinterCounters $ip $printerName
        if (-not $current) { break }

        $diffColor = $current.color - $prev.color
        $diffMono = $current.mono - $prev.mono

        Write-Host "   [COUNTER] Attempt $i | Color diff: $diffColor | Mono diff: $diffMono" -ForegroundColor DarkGray

        if ($diffColor -gt 0 -or $diffMono -gt 0) { break }  # counter udah update, stop
    }

    if (-not $current) { return $null }

    $diffColor = $current.color - $prev.color
    $diffMono = $current.mono - $prev.mono

    # Update cache
    $printerCounterCache[$printerName] = $current

    if ($diffColor -gt 0 -and $diffMono -eq 0) { return $true }
    if ($diffMono -gt 0 -and $diffColor -eq 0) { return $false }
    if ($diffColor -gt $diffMono) { return $true }
    if ($diffMono -gt $diffColor) { return $false }

    return $null
}

# ── Detect color dengan fallback chain 
function Detect-IsColor {
    param($printerName = "", $msg = $null, $pages = 1)

    # Debug: lihat isi cache
    Write-Host "   [DEBUG] Looking for '$printerName' in cache keys: $($jobColorCache.Keys -join ', ')" -ForegroundColor DarkYellow

    $cacheHit = $jobColorCache.Keys | Where-Object { $_ -like "$printerName|*" } | Select-Object -Last 1
    if ($cacheHit) {
        $isColor = $jobColorCache[$cacheHit]
        $jobColorCache.Remove($cacheHit)
        Write-Host "   [DEBUG] Cache hit: $cacheHit -> $(if($isColor){'COLOR'}else{'B&W'})" -ForegroundColor DarkYellow
        return $isColor
    }

    Write-Host "   [DEBUG] Cache miss for '$printerName'" -ForegroundColor DarkYellow

    if ($msg -ne $null) {
        if ($msg -match "grayscale|monochrome") { return $false }
        if ($msg -match "color\s*:\s*true") { return $true }
    }

    return $false
}

# ── Pre-cache IP dan counter semua printer saat startup ───────────────────
Write-Host "[INIT] Scanning printers..." -ForegroundColor Cyan
$allPrinters = Get-Printer | Where-Object { $_.Name -notmatch "OneNote|PDF|Fax|Microsoft|XPS" }
foreach ($p in $allPrinters) {
    $ip = Get-PrinterIP $p.Name
    if ($ip) {
        $counters = Get-PrinterCounters $ip $p.Name
        if ($counters) {
            $printerCounterCache[$p.Name] = $counters
            Write-Host "   [INIT] $($p.Name) → Color: $($counters.color) | Mono: $($counters.mono)" -ForegroundColor Green
        }
        else {
            Write-Host "   [INIT] $($p.Name) → IP found ($ip) but no counter data" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "   [INIT] $($p.Name) → IP not found, using WMI fallback" -ForegroundColor Yellow
    }
}
Write-Host ""

# ── Helper functions 
function Send-ToAPI {
    param($printer, $pages, $doc, $source, $isColor = $false)
    try {
        $body = @{
            printer    = $printer
            pages      = $pages
            document   = $doc
            timestamp  = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
            source     = $source
            isColor    = $isColor
            colorPages = if ($isColor) { $pages } else { 0 }
            bwPages    = if ($isColor) { 0 } else { $pages }
        } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri $API_URL -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
        $typeLabel = if ($isColor) { "COLOR" } else { "B&W" }
        Write-Host "   [OK] Sent ($pages pages, $typeLabel, via $source)" -ForegroundColor Blue
        return $true
    }
    catch {
        Write-Host "   [OFFLINE] API offline" -ForegroundColor Gray
        return $false
    }
}

function Extract-PrinterFromMessage {
    param($msg)
    if ($msg -match "printed on\s+(.+?)\s+via") { return $matches[1].Trim() }
    if ($msg -match "printed on\s+(.+?)\s+through") { return $matches[1].Trim() }
    if ($msg -match "printed on\s+(.+?)[\.\r\n]") { return $matches[1].Trim() }
    if ($msg -match "printer\s+name:\s*(.+?)[\r\n\.]") { return $matches[1].Trim() }
    if ($msg -match "printer\s*:\s*(.+?)[\r\n\.]") { return $matches[1].Trim() }
    return $null
}

function Extract-PagesFromMessage {
    param($msg)
    if ($msg -match "Pages printed:\s*(\d+)") { return [int]$matches[1] }
    if ($msg -match "Total pages:\s*(\d+)") { return [int]$matches[1] }
    if ($msg -match "(\d+)\s+page") { return [int]$matches[1] }
    return 1
}

function Extract-DocFromMessage {
    param($msg)
    if ($msg -match "Document\s+\d+,\s+(.+?)\s+owned") { return $matches[1].Trim() }
    if ($msg -match "Document name:\s*(.+?)[\r\n\.]") { return $matches[1].Trim() }
    return "Print Job"
}

# ── Main loop ─────────────────────────────────────────────────────────────
while ($true) {
    $iteration++
    $currentTime = Get-Date

    if (($currentTime - $heartbeatTime).TotalSeconds -ge 60) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Heartbeat #$iteration | EventLog: $eventLogWorks" -ForegroundColor Gray
        $heartbeatTime = $currentTime
    }

    # ── METHOD 1: WMI - cache color property saja ─────────────────────────
    try {
        $wmiJobs = Get-WmiObject Win32_PrintJob -ErrorAction SilentlyContinue
        if ($wmiJobs) {
            foreach ($job in $wmiJobs) {
                $printer = ($job.Name -split ',')[0].Trim()
                if ([string]::IsNullOrWhiteSpace($printer) -or
                    $printer -match "OneNote|PDF|Fax|Microsoft|XPS") { continue }

                $jobId = $job.JobId
                $cacheKey = "$printer|$jobId"
                if (-not $jobColorCache.ContainsKey($cacheKey)) {
                    $isColorWMI = ($job.Color -eq "Color")
                    $jobColorCache[$cacheKey] = $isColorWMI
                    $typeLabel = if ($isColorWMI) { "COLOR" } else { "B&W" }
                    Write-Host "   [WMI-CACHE] $($job.Document) -> $printer ($typeLabel)" -ForegroundColor DarkGray
                }
            }
        }
    }
    catch {}

    # ── METHOD 2: Event Log ───────────────────────────────────────────────
    if ($eventLogWorks) {
        try {
            $failCount = 0
            $newEvents = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" `
                -MaxEvents 50 -ErrorAction Stop |
            Where-Object { $_.Id -eq 307 -and $_.RecordId -gt $lastRecordId } |
            Sort-Object RecordId

            foreach ($e in $newEvents) {
                $lastRecordId = $e.RecordId
                $msg = $e.Message
                $printer = Extract-PrinterFromMessage $msg
                $pages = Extract-PagesFromMessage $msg
                $doc = Extract-DocFromMessage $msg

                if (-not $printer -or $printer -match "OneNote|PDF|Fax|Microsoft|XPS") { continue }

                $jobKey = "EVT|$($e.RecordId)|$printer"
                if (-not $processedJobs.ContainsKey($jobKey)) {
                    $isColor = Detect-IsColor -printerName $printer -msg $msg -pages $pages
                    $typeLabel = if ($isColor) { "COLOR" } else { "B&W" }
                    $color = if ($printer -match "Canon|MF6\d{2}") { "Magenta" } else { "Cyan" }
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [EventLog] $doc -> $printer ($pages pages, $typeLabel)" -ForegroundColor $color
                    if (Send-ToAPI $printer $pages $doc "EventLog-307" $isColor) {
                        $processedJobs[$jobKey] = Get-Date
                    }
                }
            }
        }
        catch {
            $failCount++
            if ($failCount -ge 5) {
                $eventLogWorks = $false
                Write-Host "[WARN] Event Log unavailable, using WMI only" -ForegroundColor Red
            }
        }
    }

    # ── Cleanup cache ─────────────────────────────────────────────────────
    $cutoff = (Get-Date).AddMinutes(-10)
    $old = @($processedJobs.Keys | Where-Object { $processedJobs[$_] -lt $cutoff })
    foreach ($key in $old) { $processedJobs.Remove($key) }

    Start-Sleep -Seconds $Interval
}