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
    return [];
  }
}

function extractIpAddress(p) {
  let ipAddress = null;

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
    return null;
  }

  if (p.PortName) {
    const ipv4Match = p.PortName.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/);
    if (ipv4Match) {
      ipAddress = ipv4Match[0];
      return ipAddress;
    }
  }

  if (p.Location) {
    const ipv4Match = p.Location.match(/http:\/\/(\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b)/);
    if (ipv4Match) {
      ipAddress = ipv4Match[1];
      return ipAddress;
    }

    const ipv6Match = p.Location.match(/http:\/\/\[([^\]]+)\]/);
    if (ipv6Match) {
      const ipv6Address = ipv6Match[1];
      return ipv6Address;
    }

    const hostnameMatch = p.Location.match(/http:\/\/([^:/]+)/);
    if (hostnameMatch) {
      const hostname = hostnameMatch[1];
      return hostname;
    }
  }

  if (p.PortName && p.PortName.includes("_")) {
    const portParts = p.PortName.split("_");
    if (portParts[0] && portParts[0].match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/)) {
      ipAddress = portParts[0];
      return ipAddress;
    }
  }

  if (p.PortName && p.PortName.includes("WSD")) {
    return null;
  }

  return null;
}

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

    for (const skipName of skipPrinters) {
      if (printerName.includes(skipName)) {
        return null;
      }
    }

    const driverName = p.DriverName || '';
    if (driverName.includes('Microsoft') &&
      (driverName.includes('PDF') || driverName.includes('XPS') || driverName.includes('Fax'))) {
      return null;
    }

    const portName = p.PortName || '';
    if (portName.includes('PORTPROMPT:') ||
      portName.includes('FILE:') ||
      portName.includes('SHRFAX:') ||
      portName.toLowerCase().includes('pdf') ||
      portName.toLowerCase().includes('xps')) {
      return null;
    }

    let statusInfo =
      PRINTER_STATUS_MAP[p.PrinterStatus] || PRINTER_STATUS_MAP[2];

    if (p.WorkOffline === true) {
      statusInfo = {
        status: "OFFLINE",
        category: "OFFLINE",
        severity: "ERROR",
        description: "Printer set to Work Offline",
      };
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
    }

    const ipAddress = extractIpAddress(p);
    const isNetwork = ipAddress !== null;
    const portType = determinePortType(p.PortName);

    const vendor = detectVendor(p.DriverName || "", p.Comment || "");

    const recentErrors = await getPrinterErrorDetails(p.Name);
    const errorCount = recentErrors.length;

    const supportsInkMonitoring =
      isNetwork &&
      vendor !== "Unknown" &&
      (vendor === "HP" ||
        vendor === "Canon" ||
        vendor === "Epson" ||
        vendor === "Brother" ||
        vendor === "Xerox");

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

      healthStatus: statusInfo.category,
      healthSeverity: statusInfo.severity,
      description: statusInfo.description || "",
      recentErrors: recentErrors,
      errorCount: errorCount,

      totalPages: 0,
      todayPages: 0,
      lastPrintTime: null,

      inkStatus: {
        supported: false,
        levels: {},
        lastChecked: null,
        alert: null,
      },
    };

    const printer = new Printer(printerData);

    return printer;
  } catch (error) {
    return new Printer({
      name: p.Name || "Unknown Printer",
      rawStatus: p.PrinterStatus || 0,
      status: "UNKNOWN",
      driverName: p.DriverName || "",
      portName: p.PortName || "",
    });
  }
}

export async function normalizePrinters(printers) {
  try {
    if (!Array.isArray(printers)) {
      printers = [printers];
    }

    const normalizedPromises = printers.map(normalizePrinter);
    const normalizedPrinters = await Promise.all(normalizedPromises);

    const validPrinters = normalizedPrinters.filter((p) => p && p.name);

    const ipMap = {};
    validPrinters.forEach(p => {
      if (p.ipAddress) {
        ipMap[p.ipAddress] = (ipMap[p.ipAddress] || 0) + 1;
      }
    });

    return validPrinters;
  } catch (error) {
    return [];
  }
}

export function getPrinterStatusText(statusCode) {
  return PrinterStatusCodes[statusCode] || "UNKNOWN";
}

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

export function isPrinterPrinting(printer) {
  const status = printer.status || printer.Status;
  const rawStatus = printer.rawStatus || printer.PrinterStatus;

  return status === "PRINTING" || rawStatus === 4;
}

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

export async function enrichPrinterData(printer, additionalData = {}) {
  try {
    if (additionalData.inkStatus) {
      printer.updateInkStatus(additionalData.inkStatus);
    }

    if (additionalData.pageCount) {
      printer.updatePageCount(
        additionalData.pageCount.pages,
        additionalData.pageCount.isToday,
      );
    }

    if (additionalData.resolvedIp && !printer.ipAddress) {
      printer.ipAddress = additionalData.resolvedIp;
    }

    return printer;
  } catch (error) {
    return printer;
  }
}

export {
  getPrinterErrorDetails,
  extractIpAddress,
  determinePortType,
  PRINTER_STATUS_MAP,
};