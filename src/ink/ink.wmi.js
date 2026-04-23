import { runPowerShell } from "../utils/powershell.js";

export async function getInkStatusWMI(printerName) {
  const psScript = `
\$printerName = '${printerName.replace(/'/g, "''")}'

\$allPrinters = Get-WmiObject -Class Win32_Printer
\$printer = \$allPrinters | Where-Object { \$_.Name -eq \$printerName } | Select-Object -First 1

if (-not \$printer) { 
  @{error = "Printer not found"; printerName = \$printerName} | ConvertTo-Json
  exit
}

\$result = @{
  printer = \$printer.Name
  detected = \$true
  supported = \$false
  levels = @{}
  vendor = "Unknown"
  lastChecked = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  message = ""
  portType = "Unknown"
}

if (\$printer.PortName -match 'USB') {
  \$result.portType = "USB"
} elseif (\$printer.PortName -match 'WSD') {
  \$result.portType = "WSD Network"
} elseif (\$printer.PortName -match 'IP_|TCP') {
  \$result.portType = "TCP/IP Network"
} else {
  \$result.portType = "Other"
}

if (\$printer.DriverName -match 'Canon') {
  \$result.vendor = "Canon"
  \$result.message = "Canon USB printer detected. Windows does not provide ink levels for Canon printers via standard APIs."
  
  \$canonStatusMonitor = Get-Process -Name "CNMSTMON" -ErrorAction SilentlyContinue
  if (\$canonStatusMonitor) {
    \$result.message = "Canon Status Monitor is running."
    \$result.supported = \$true
  } else {
    \$result.message = "Install Canon Status Monitor from Canon website for ink monitoring."
  }
}
elseif (\$printer.DriverName -match 'Epson') {
  \$result.vendor = "Epson"
  \$result.message = "Epson printer detected. Requires Epson Status Monitor for ink levels."
}
elseif (\$printer.DriverName -match 'HP') {
  \$result.vendor = "HP"
  if (\$result.portType -match "Network") {
    \$result.message = "HP Network printer. Use SNMP for ink monitoring."
  } else {
    \$result.message = "HP USB printer. HP Smart app may provide ink levels."
  }
}
else {
  \$result.vendor = "Generic"
  if (\$result.portType -eq "USB") {
    \$result.message = "Generic USB printer. Ink monitoring not available via standard Windows APIs."
  } else {
    \$result.message = "Generic printer detected."
  }
}

\$result | ConvertTo-Json -Depth 3
`;

  try {
    const output = await runPowerShell(psScript);

    let data;
    try {
      data = JSON.parse(output);
    } catch (parseError) {
      return {
        supported: false,
        error: `JSON parse error: ${parseError.message}`,
        printer: printerName,
        lastChecked: new Date().toISOString(),
        rawOutput: output.substring(0, 500)
      };
    }

    if (data.error) {
      return {
        supported: false,
        error: data.error,
        printer: printerName,
        lastChecked: new Date().toISOString()
      };
    }

    return {
      ...data,
      lastChecked: new Date().toISOString(),
      monitoringMethod: "WMI"
    };

  } catch (error) {
    return {
      supported: false,
      error: error.message,
      printer: printerName,
      message: "WMI query failed",
      lastChecked: new Date().toISOString(),
      stack: error.stack
    };
  }
}