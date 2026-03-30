// ink.wmi.js - VERSI FIXED
import { runPowerShell } from "../utils/powershell.js";

export async function getInkStatusWMI(printerName) {
  console.log(`🖨️ WMI Ink Check for: ${printerName}`);

  const psScript = `
\$printerName = '${printerName.replace(/'/g, "''")}'

# Get printer
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

# Determine port type
if (\$printer.PortName -match 'USB') {
  \$result.portType = "USB"
} elseif (\$printer.PortName -match 'WSD') {
  \$result.portType = "WSD Network"
} elseif (\$printer.PortName -match 'IP_|TCP') {
  \$result.portType = "TCP/IP Network"
} else {
  \$result.portType = "Other"
}

# ===== DETECT VENDOR =====
if (\$printer.DriverName -match 'Canon') {
  \$result.vendor = "Canon"
  \$result.message = "Canon USB printer detected. Windows does not provide ink levels for Canon printers via standard APIs."
  
  # Check if Canon Status Monitor is installed
  \$canonStatusMonitor = Get-Process -Name "CNMSTMON" -ErrorAction SilentlyContinue
  if (\$canonStatusMonitor) {
    \$result.message = "Canon Status Monitor is running."
    \$result.supported = \$true
  } else {
    \$result.message = "Install Canon Status Monitor from Canon website for ink monitoring."
  }
}
# ===== EPSON PRINTERS =====
elseif (\$printer.DriverName -match 'Epson') {
  \$result.vendor = "Epson"
  \$result.message = "Epson printer detected. Requires Epson Status Monitor for ink levels."
}
# ===== HP PRINTERS =====
elseif (\$printer.DriverName -match 'HP') {
  \$result.vendor = "HP"
  if (\$result.portType -match "Network") {
    \$result.message = "HP Network printer. Use SNMP for ink monitoring."
  } else {
    \$result.message = "HP USB printer. HP Smart app may provide ink levels."
  }
}
# ===== GENERIC PRINTERS =====
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
    console.log(`📝 Running WMI script for ${printerName}...`);
    const output = await runPowerShell(psScript);

    let data;
    try {
      data = JSON.parse(output);
    } catch (parseError) {
      console.error(`❌ Failed to parse WMI JSON:`, output.substring(0, 200));
      return {
        supported: false,
        error: `JSON parse error: ${parseError.message}`,
        printer: printerName,
        lastChecked: new Date().toISOString(),
        rawOutput: output.substring(0, 500)
      };
    }

    if (data.error) {
      console.log(`❌ Printer not found in WMI: ${printerName}`);
      return {
        supported: false,
        error: data.error,
        printer: printerName,
        lastChecked: new Date().toISOString()
      };
    }

    console.log(`📊 WMI result for ${printerName}:`, data);

    return {
      ...data,
      lastChecked: new Date().toISOString(),
      monitoringMethod: "WMI"
    };

  } catch (error) {
    console.error(`💥 Error in WMI for ${printerName}:`, error);
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