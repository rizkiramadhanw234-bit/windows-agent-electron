// printer.parser.js - FIXED VERSION
import { Printer } from "./printer.model.js";
import { detectVendor, PrinterStatusCodes } from "./printer.model.js";

const PRINTER_STATUS_MAP = {
  1: { status: "OTHER", category: "OTHER", severity: "INFO" },
  2: { status: "UNKNOWN", category: "UNKNOWN", severity: "INFO" },
  3: { status: "READY", category: "READY", severity: "HEALTHY" },
  4: { status: "PRINTING", category: "PRINTING", severity: "HEALTHY" },
  5: { status: "WARMUP", category: "WARMUP", severity: "INFO" },
  6: {
    status: "STOPPED",
    category: "ERROR",
    severity: "ERROR",
    description: "Printing stopped",
  },
  7: {
    status: "OFFLINE",
    category: "OFFLINE",
    severity: "ERROR",
    description: "Printer offline",
  },
  8: {
    status: "PAPER_JAM",
    category: "ERROR",
    severity: "CRITICAL",
    description: "Paper jam detected",
  },
  9: {
    status: "OUT_OF_PAPER",
    category: "ERROR",
    severity: "CRITICAL",
    description: "Out of paper",
  },
  10: {
    status: "MANUAL_FEED",
    category: "WARNING",
    severity: "WARNING",
    description: "Manual feed required",
  },
  11: {
    status: "PAPER_PROBLEM",
    category: "ERROR",
    severity: "ERROR",
    description: "Paper problem",
  },
  12: {
    status: "OUTPUT_BIN_FULL",
    category: "WARNING",
    severity: "WARNING",
    description: "Output bin full",
  },
  13: {
    status: "NOT_AVAILABLE",
    category: "UNAVAILABLE",
    severity: "ERROR",
    description: "Printer not available",
  },
  14: { status: "WAITING", category: "WAITING", severity: "INFO" },
  15: { status: "PROCESSING", category: "PROCESSING", severity: "INFO" },
  16: { status: "INITIALIZING", category: "INITIALIZING", severity: "INFO" },
  17: { status: "WARMING_UP", category: "WARMUP", severity: "INFO" },
  18: {
    status: "TONER_LOW",
    category: "WARNING",
    severity: "WARNING",
    description: "Toner/ink low",
  },
  19: {
    status: "NO_TONER",
    category: "ERROR",
    severity: "CRITICAL",
    description: "No toner/ink",
  },
  20: {
    status: "PAGE_PUNT",
    category: "ERROR",
    severity: "ERROR",
    description: "Page punt error",
  },
  21: {
    status: "USER_INTERVENTION",
    category: "ERROR",
    severity: "ERROR",
    description: "User intervention required",
  },
  22: {
    status: "OUT_OF_MEMORY",
    category: "ERROR",
    severity: "ERROR",
    description: "Out of memory",
  },
  23: {
    status: "DOOR_OPEN",
    category: "ERROR",
    severity: "CRITICAL",
    description: "Door open",
  },
  24: {
    status: "SERVER_UNKNOWN",
    category: "ERROR",
    severity: "ERROR",
    description: "Print server unknown",
  },
  25: { status: "POWER_SAVE", category: "POWER_SAVE", severity: "INFO" },
};

// Helper function to get printer errors
async function getPrinterErrorDetails(printerName) {
  try {
    const { runPowerShell } = await import("../utils/powershell.js");

    const script = `
$lastHour = (Get-Date).AddHours(-1)
$events = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -FilterXPath "*[System[(Level=2 or Level=3) and TimeCreated[@SystemTime>='$($lastHour.ToString('yyyy-MM-ddTHH:mm:ss'))']]]" -ErrorAction SilentlyContinue | 
           Where-Object { $_.Message -match "${printerName.replace(/[\\']/g, "\\$&")}" } |
           Select-Object TimeCreated, Id, LevelDisplayName, Message |
           ForEach-Object {
               @{
                   time = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
                   id = $_.Id
                   level = $_.LevelDisplayName
                   message = $_.Message
               }
           }

if ($events) {
  $events | ConvertTo-Json -Compress
} else {
  '[]'
}
`;

    const result = await runPowerShell(script);
    return JSON.parse(result) || [];
  } catch (error) {
    console.error(
      `Error getting printer errors for ${printerName}:`,
      error.message,
    );
    return [];
  }
}

// Extract IP address from various sources - IMPROVED VERSION
function extractIpAddress(p) {
  let ipAddress = null;
  
  // Debug input
  console.log(`🔍 Extracting IP for: ${p.Name}`);
  console.log(`   PortName: ${p.PortName}`);
  console.log(`   Location: ${p.Location}`);

  const isNetwork =
    (p.PortName &&
      (p.PortName.includes("IP_") ||
        p.PortName.includes("WSD") ||
        p.PortName.includes("192.") ||
        p.PortName.includes("169.") ||
        p.PortName.includes("10."))) ||
    (p.Location && p.Location.includes("http://")) ||
    false;

  if (!isNetwork) {
    console.log(`   Not a network printer`);
    return null;
  }

  // Priority 1: Try to extract IPv4 from PortName
  if (p.PortName) {
    const ipv4Match = p.PortName.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/);
    if (ipv4Match) {
      ipAddress = ipv4Match[0];
      console.log(`📍 Found IPv4 in PortName: ${ipAddress}`);
      return ipAddress;
    }
  }

  // Priority 2: Try to extract from Location (URL)
  if (p.Location) {
    // Handle IPv4 in URL: http://192.168.18.178:3911/
    const ipv4Match = p.Location.match(/http:\/\/(\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b)/);
    if (ipv4Match) {
      ipAddress = ipv4Match[1];
      console.log(`📍 Found IPv4 in Location: ${ipAddress}`);
      return ipAddress;
    }

    // Handle IPv6 addresses like "http://[fe80::b20c:d1ff:fedc:97f2%10]:3911/"
    const ipv6Match = p.Location.match(/http:\/\/\[([^\]]+)\]/);
    if (ipv6Match) {
      const ipv6Address = ipv6Match[1];
      console.log(`📍 Found IPv6 in Location: ${ipv6Address}`);
      return ipv6Address;
    }

    // Handle hostnames in URL (will be resolved later by ink service)
    const hostnameMatch = p.Location.match(/http:\/\/([^:/]+)/);
    if (hostnameMatch) {
      const hostname = hostnameMatch[1];
      console.log(`📍 Found hostname in Location: ${hostname}`);
      return hostname;
    }
  }

  // Priority 3: Check if PortName is an IP port (like "192.168.1.100_9100")
  if (p.PortName && p.PortName.includes("_")) {
    const portParts = p.PortName.split("_");
    if (portParts[0] && portParts[0].match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/)) {
      ipAddress = portParts[0];
      console.log(`📍 Found IP in PortName (with port): ${ipAddress}`);
      return ipAddress;
    }
  }

  // Priority 4: Check for WSD printers
  if (p.PortName && p.PortName.includes("WSD")) {
    console.log(`🌐 WSD printer detected: ${p.Name}`);
    // Return null, let ink service handle WSD resolution
    return null;
  }

  console.log(`❌ No IP address found for printer: ${p.Name}`);
  return null;
}

// Determine port type based on port name
function determinePortType(portName) {
  if (!portName) return "unknown";

  portName = portName.toLowerCase();

  if (portName.includes("wsd")) return "wsd";
  if (portName.includes("usb")) return "usb";
  if (portName.includes("lpt")) return "parallel";
  if (portName.includes("com")) return "serial";
  if (portName.includes("ip_")) return "tcpip";
  if (
    portName.includes("192.") ||
    portName.includes("169.") ||
    portName.includes("10.")
  )
    return "tcpip";
  if (portName.includes("localhost")) return "local";
  if (portName.includes("fax")) return "fax";

  return "unknown";
}

export async function normalizePrinter(p) {
  try {
    console.log(
      `🛠️ Normalizing printer: ${p.Name || "Unknown"} (Status: ${p.PrinterStatus || 0})`,
    );

    // Skip printer digital bawaan Windows
    const skipPrinters = [
      'Microsoft Print to PDF',
      'Microsoft XPS Document Writer',
      'Fax',
      'OneNote',
      'Adobe PDF',
      'Send To OneNote',
      'Microsoft Print to PDF (redirected)'
    ];

    const printerName = p.Name || '';
    
    // Cek apakah printer termasuk yang harus di-skip
    for (const skipName of skipPrinters) {
      if (printerName.includes(skipName)) {
        console.log(`⏭️ Skipping digital printer: ${printerName}`);
        return null; // Return null untuk di-filter nanti
      }
    }

    // Skip berdasarkan driver name juga
    const driverName = p.DriverName || '';
    if (driverName.includes('Microsoft') && 
        (driverName.includes('PDF') || driverName.includes('XPS') || driverName.includes('Fax'))) {
      console.log(`⏭️ Skipping Microsoft digital printer driver: ${driverName}`);
      return null;
    }

    // Skip berdasarkan port name (virtual ports)
    const portName = p.PortName || '';
    if (portName.includes('PORTPROMPT:') || 
        portName.includes('FILE:') || 
        portName.includes('SHRFAX:') ||
        portName.toLowerCase().includes('pdf') ||
        portName.toLowerCase().includes('xps')) {
      console.log(`⏭️ Skipping virtual port printer: ${printerName} (Port: ${portName})`);
      return null;
    }

    // Get status info from map
    let statusInfo =
      PRINTER_STATUS_MAP[p.PrinterStatus] || PRINTER_STATUS_MAP[2];

    // Special overrides
    if (p.WorkOffline === true) {
      statusInfo = {
        status: "OFFLINE",
        category: "OFFLINE",
        severity: "ERROR",
        description: "Printer set to Work Offline",
      };
      console.log(`⚠️ Printer ${p.Name} is set to Work Offline`);
    }

    if (
      p.Name &&
      (p.Name.includes("Offline") || p.Name.includes("(Offline)"))
    ) {
      statusInfo = {
        status: "OFFLINE",
        category: "OFFLINE",
        severity: "ERROR",
        description: "Printer name indicates offline",
      };
      console.log(`📛 Printer name indicates offline: ${p.Name}`);
    }

    // Extract IP address and determine network status
    const ipAddress = extractIpAddress(p);
    const isNetwork = ipAddress !== null;
    const portType = determinePortType(p.PortName);

    // Detect vendor
    const vendor = detectVendor(p.DriverName || "", p.Comment || "");

    // Get printer errors (async)
    const recentErrors = await getPrinterErrorDetails(p.Name);
    const errorCount = recentErrors.length;

    // Determine if printer supports ink monitoring
    const supportsInkMonitoring =
      isNetwork &&
      vendor !== "Unknown" &&
      (vendor === "HP" ||
        vendor === "Canon" ||
        vendor === "Epson" ||
        vendor === "Brother" ||
        vendor === "Xerox");

    // Create Printer instance with all data
    const printerData = {
      name: p.Name || "",
      rawStatus: p.PrinterStatus || 0,
      status: statusInfo.status,
      shared: p.Shared === true,
      workOffline: p.WorkOffline || false,
      portName: p.PortName || "",
      driverName: p.DriverName || "",
      location: p.Location || "",
      comment: p.Comment || "",
      ipAddress: ipAddress,
      isNetwork: isNetwork,
      portType: portType,
      vendor: vendor,
      supportsInkMonitoring: supportsInkMonitoring,

      // Health and error information
      healthStatus: statusInfo.category,
      healthSeverity: statusInfo.severity,
      description: statusInfo.description || "",
      recentErrors: recentErrors,
      errorCount: errorCount,

      // Statistics (will be updated later)
      totalPages: 0,
      todayPages: 0,
      lastPrintTime: null,

      // Ink status (will be updated by ink service)
      inkStatus: {
        supported: false,
        levels: {},  // Object kosong, akan diisi oleh ink service
        lastChecked: null,
        alert: null,
      },
    };

    // Create instance of Printer model
    const printer = new Printer(printerData);

    console.log(
      `✅ Created printer instance: ${printer.name} (${vendor}) - Status: ${printer.status} - IP: ${ipAddress || "N/A"}`,
    );

    return printer;
  } catch (error) {
    console.error(`❌ Error normalizing printer ${p.Name}:`, error);

    // Return minimal printer object as fallback
    return new Printer({
      name: p.Name || "Unknown Printer",
      rawStatus: p.PrinterStatus || 0,
      status: "UNKNOWN",
      driverName: p.DriverName || "",
      portName: p.PortName || "",
    });
  }
}

// Utility function to normalize multiple printers
export async function normalizePrinters(printers) {
  try {
    if (!Array.isArray(printers)) {
      printers = [printers];
    }

    console.log(`📊 Normalizing ${printers.length} printers...`);
    
    const normalizedPromises = printers.map(normalizePrinter);
    const normalizedPrinters = await Promise.all(normalizedPromises);

    // Filter out null/undefined printers
    const validPrinters = normalizedPrinters.filter((p) => p && p.name);

    // Debug: Check for duplicate IPs
    const ipMap = {};
    validPrinters.forEach(p => {
      if (p.ipAddress) {
        ipMap[p.ipAddress] = (ipMap[p.ipAddress] || 0) + 1;
      }
    });

    Object.entries(ipMap).forEach(([ip, count]) => {
      if (count > 1) {
        console.warn(`⚠️ WARNING: IP ${ip} used by ${count} printers!`);
      }
    });

    console.log(`✅ Normalized ${validPrinters.length} printer(s)`);
    return validPrinters;
  } catch (error) {
    console.error("❌ Error normalizing printers:", error);
    return [];
  }
}

// Function to get printer status text from code
export function getPrinterStatusText(statusCode) {
  return PrinterStatusCodes[statusCode] || "UNKNOWN";
}

// Function to check if printer is online based on status
export function isPrinterOnline(printer) {
  const status = printer.status || printer.Status;
  const rawStatus = printer.rawStatus || printer.PrinterStatus;

  if (status === "OFFLINE" || printer.workOffline === true) {
    return false;
  }

  return (
    status === "READY" ||
    status === "PRINTING" ||
    rawStatus === 3 ||
    rawStatus === 4
  );
}

// Function to check if printer is printing
export function isPrinterPrinting(printer) {
  const status = printer.status || printer.Status;
  const rawStatus = printer.rawStatus || printer.PrinterStatus;

  return status === "PRINTING" || rawStatus === 4;
}

// Function to get printer health summary
export function getPrinterHealthSummary(printer) {
  const severity = printer.healthSeverity || "INFO";
  const status = printer.status || "UNKNOWN";

  switch (severity) {
    case "CRITICAL":
      return {
        health: "CRITICAL",
        icon: "🔴",
        message: printer.description || "Printer has critical issues",
      };
    case "ERROR":
      return {
        health: "ERROR",
        icon: "🟠",
        message: printer.description || "Printer has errors",
      };
    case "WARNING":
      return {
        health: "WARNING",
        icon: "🟡",
        message: printer.description || "Printer has warnings",
      };
    case "HEALTHY":
      return {
        health: "HEALTHY",
        icon: "🟢",
        message: "Printer is operational",
      };
    default:
      return {
        health: "UNKNOWN",
        icon: "⚪",
        message: "Printer status unknown",
      };
  }
}

// Function to enrich printer with additional data
export async function enrichPrinterData(printer, additionalData = {}) {
  try {
    // Update ink status if provided
    if (additionalData.inkStatus) {
      printer.updateInkStatus(additionalData.inkStatus);
    }

    // Update page counts if provided
    if (additionalData.pageCount) {
      printer.updatePageCount(
        additionalData.pageCount.pages,
        additionalData.pageCount.isToday,
      );
    }

    // Update IP address if resolved from ink service
    if (additionalData.resolvedIp && !printer.ipAddress) {
      printer.ipAddress = additionalData.resolvedIp;
      console.log(`🔗 Updated IP for ${printer.name}: ${additionalData.resolvedIp}`);
    }

    return printer;
  } catch (error) {
    console.error(`Error enriching printer ${printer.name}:`, error);
    return printer;
  }
}

// Export helper functions
export {
  getPrinterErrorDetails,
  extractIpAddress,
  determinePortType,
  PRINTER_STATUS_MAP,
};