import { getInkStatusSNMP, testSNMPConnection } from "./ink.snmp.js";
import { getInkStatusWMI } from "./ink.wmi.js";
import { runPowerShell } from "../utils/powershell.js";

const inkCache = new Map();
const CACHE_TTL = 300000; // fix: 5 menit (was: 30 detik — terlalu sering)

// ─── Cache cleanup otomatis tiap 10 menit ─────────────────────────────────
// mencegah inkCache tumbuh tak terbatas di memory
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of inkCache.entries()) {
    if (now - val.timestamp > CACHE_TTL) inkCache.delete(key);
  }
}, 600000);

async function discoverPrinterIP(printerInfo) {
  let ip = null;

  if (printerInfo.PortName) {
    const ipv4MatchPort = printerInfo.PortName.match(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    );
    if (ipv4MatchPort) {
      ip = ipv4MatchPort[0];
      return ip;
    }
  }

  if (printerInfo.Location) {
    const ipv4MatchLocation = printerInfo.Location.match(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    );
    if (ipv4MatchLocation) {
      ip = ipv4MatchLocation[0];
      return ip;
    }

    const ipv6Match = printerInfo.Location.match(/\[([0-9a-fA-F:]+)\]/);
    if (ipv6Match) {
      ip = ipv6Match[1];
      return ip;
    }
  }

  if (!ip && printerInfo.PortName && printerInfo.PortName.startsWith("WSD")) {
    if (printerInfo.Location && printerInfo.Location.includes("http://")) {
      try {
        const url = new URL(printerInfo.Location);
        const hostname = url.hostname;

        if (hostname.startsWith("[") && hostname.endsWith("]")) {
          ip = hostname.slice(1, -1);
          return ip;
        }
        else if (hostname.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)) {
          ip = hostname;
          return ip;
        }
      } catch (error) {
        // URL parsing failed
      }
    }

    const hostMatch = printerInfo.Name.match(/^([^\(]+)/);
    if (hostMatch) {
      const hostname = hostMatch[1].trim();

      const pingScript = `
\$hostname = '${hostname}'
try {
    \$ping = Test-Connection -ComputerName \$hostname -Count 1 -ErrorAction SilentlyContinue
    if (\$ping) {
        if (\$ping.IPV4Address) {
            \$ping.IPV4Address.IPAddressToString
        } elseif (\$ping.IPV6Address) {
            \$ping.IPV6Address.IPAddressToString
        } else {
            "NOT_FOUND"
        }
    } else {
        "NOT_FOUND"
    }
} catch {
    "ERROR"
}
`;

      try {
        const pingResult = await runPowerShell(pingScript);
        if (
          pingResult &&
          pingResult !== "NOT_FOUND" &&
          pingResult !== "ERROR"
        ) {
          ip = pingResult.trim();
        }
      } catch (error) {
        // Ping failed
      }
    }
  }

  if (!ip && printerInfo.PortName && printerInfo.PortName.startsWith("WSD")) {
    const wsdScript = `
\$printerName = '${printerInfo.Name.replace(/'/g, "''")}'
try {
    \$wsdPrinter = Get-Printer -Name \$printerName | Select-Object Name, DeviceType, PortName, DriverName, ComputerName, Location, DevicePath
    
    if (\$wsdPrinter) {
        \$devicePath = \$wsdPrinter.DevicePath
        
        if (\$devicePath -and \$devicePath -match 'http://([^:]+)') {
            \$hostPart = \$matches[1]
            
            if (\$hostPart -match '^\\[(.*)\\]$') {
                \$ip = \$matches[1]
                Write-Output \$ip
                exit
            }
            else {
                \$ip = [System.Net.Dns]::GetHostAddresses(\$hostPart) | 
                       Where-Object { \$_.AddressFamily -eq 'InterNetwork' } | 
                       Select-Object -First 1 -ExpandProperty IPAddressToString
                
                if (\$ip) {
                    Write-Output \$ip
                    exit
                }
            }
        }
        
        \$regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\SWD\\PRINTENUM"
        if (Test-Path \$regPath) {
            \$wsdEntries = Get-ChildItem -Path \$regPath -ErrorAction SilentlyContinue
            
            foreach (\$entry in \$wsdEntries) {
                \$friendlyName = Get-ItemProperty -Path \$entry.PSPath -Name "FriendlyName" -ErrorAction SilentlyContinue
                if (\$friendlyName -and \$friendlyName.FriendlyName -eq \$printerName) {
                    \$deviceId = Get-ItemProperty -Path \$entry.PSPath -Name "DeviceID" -ErrorAction SilentlyContinue
                    if (\$deviceId) {
                        if (\$deviceId.DeviceID -match 'http://([^:]+)') {
                            \$hostPart = \$matches[1]
                            if (\$hostPart -match '^\\[(.*)\\]$') {
                                Write-Output \$matches[1]
                                exit
                            }
                        }
                    }
                }
            }
        }
        
        if (\$wsdPrinter.Location -and \$wsdPrinter.Location -match 'http://([^:]+)') {
            \$hostPart = \$matches[1]
            if (\$hostPart -match '^\\[(.*)\\]$') {
                Write-Output \$matches[1]
                exit
            }
        }
    }
    
    Write-Output "NO_IP_FOUND"
} catch {
    Write-Output "ERROR: \$_"
}
`;

    try {
      const wsdResult = await runPowerShell(wsdScript);
      if (
        wsdResult &&
        wsdResult !== "NO_IP_FOUND" &&
        wsdResult !== "ERROR" &&
        !wsdResult.includes("ERROR:")
      ) {
        ip = wsdResult.trim();
      }
    } catch (error) {
      // WSD IP discovery failed
    }
  }

  return ip;
}

export async function getInkStatus(printerName) {
  // fix: cacheKey pakai printerName saja, bukan printerName + Date.now()
  // versi lama: `${printerName}_${Date.now()}` → cache selalu miss → PS spawn terus
  const cacheKey = printerName;
  const cached = inkCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const escapedName = printerName.replace(/'/g, "''");
    const printerInfoScript = `
\$printer = Get-WmiObject -Class Win32_Printer | Where-Object { \$_.Name -eq '${escapedName}' } | Select-Object -First 1

if (\$printer) {
    [PSCustomObject]@{
        Name = \$printer.Name
        PortName = \$printer.PortName
        DriverName = \$printer.DriverName
        IsNetwork = \$printer.PortName -match '^IP_|^TCP|^LPR|WSD'
        WorkOffline = \$printer.WorkOffline
        PrinterStatus = \$printer.PrinterStatus
        Status = \$printer.Status
        Location = \$printer.Location
        Shared = \$printer.Shared
    } | ConvertTo-Json
} else {
    @{error = "Printer not found"; printerName = '${escapedName}'} | ConvertTo-Json
}
`;

    const infoOutput = await runPowerShell(printerInfoScript);
    const printerInfo = JSON.parse(infoOutput);

    if (printerInfo.error) {
      const errorResult = {
        supported: false,
        error: printerInfo.error,
        printer: printerName,
        lastChecked: new Date().toISOString(),
        warnings: [],
        criticalWarnings: [],
        hasWarnings: false,
        hasCriticalWarnings: false,
        inkHealthStatus: "UNKNOWN",
        warningSummary: "Printer not found",
      };

      inkCache.set(cacheKey, {
        timestamp: Date.now(),
        data: errorResult,
      });

      return errorResult;
    }

    let inkData;
    let method = "unknown";
    let printerIp = null;

    if (printerInfo.IsNetwork) {
      printerIp = await discoverPrinterIP(printerInfo);

      if (printerIp) {
        method = "SNMP";

        const timeoutPromise = new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                supported: false,
                error: "SNMP timeout",
                levels: {},
                message: "SNMP query timeout (3s)",
              }),
            3000,
          ),
        );

        const snmpPromise = getInkStatusSNMP(printerIp);
        inkData = await Promise.race([snmpPromise, timeoutPromise]);

        if (!inkData.supported) {
          method = "WMI-Fallback";
          inkData = await getInkStatusWMI(printerName);
        }
      } else {
        method = "WMI-NoIP";
        inkData = await getInkStatusWMI(printerName);
      }
    } else {
      method = "WMI-USB";
      inkData = await getInkStatusWMI(printerName);
    }

    const warnings = [];
    const criticalWarnings = [];

    if (inkData.levels) {
      Object.entries(inkData.levels).forEach(([color, level]) => {
        if (level !== null) {
          if (level <= 15) {
            const warning = {
              color: color,
              level: level,
              message: `${color} ink low: ${level}%`,
              severity: level <= 10 ? "CRITICAL" : "WARNING",
              timestamp: new Date().toISOString(),
            };

            warnings.push(warning);

            if (level <= 10) {
              criticalWarnings.push(warning);
            }
          }
        }
      });
    }

    let inkHealthStatus = "HEALTHY";
    if (criticalWarnings.length > 0) {
      inkHealthStatus = "CRITICAL";
    } else if (warnings.length > 0) {
      inkHealthStatus = "WARNING";
    } else if (!inkData.supported) {
      inkHealthStatus = "UNSUPPORTED";
    }

    const finalResult = {
      ...inkData,
      printer: printerName,
      lastChecked: new Date().toISOString(),
      monitoringMethod: method,
      printerInfo: {
        ...printerInfo,
        ipAddress: printerIp,
      },
      warnings: warnings,
      criticalWarnings: criticalWarnings,
      hasWarnings: warnings.length > 0,
      hasCriticalWarnings: criticalWarnings.length > 0,
      inkHealthStatus: inkHealthStatus,
      warningSummary:
        warnings.length > 0
          ? `${warnings.length} ink warning(s)`
          : "All ink levels normal",
    };

    inkCache.set(cacheKey, {
      timestamp: Date.now(),
      data: finalResult,
    });

    return finalResult;
  } catch (error) {
    const errorResult = {
      supported: false,
      error: error.message,
      printer: printerName,
      message: "Failed to retrieve ink status",
      lastChecked: new Date().toISOString(),
      warnings: [],
      criticalWarnings: [],
      hasWarnings: false,
      hasCriticalWarnings: false,
      inkHealthStatus: "ERROR",
      warningSummary: "Error retrieving ink status",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };

    return errorResult;
  }
}

export async function monitorAllPrintersInk() {
  try {
    const printersScript = `
Get-WmiObject -Class Win32_Printer | 
Where-Object { \$_.Name -notmatch "OneNote|PDF|Fax|Microsoft|XPS" } |
Select-Object Name, PortName, DriverName, PrinterStatus |
ConvertTo-Json
`;

    const output = await runPowerShell(printersScript);

    if (!output || output.trim() === "") {
      return {};
    }

    let printers;
    try {
      printers = JSON.parse(output);
      if (!Array.isArray(printers)) {
        printers = [printers];
      }
    } catch (parseError) {
      return {};
    }

    const results = {};

    for (let i = 0; i < printers.length; i++) {
      const printer = printers[i];
      results[printer.Name] = await getInkStatus(printer.Name);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  } catch (error) {
    return {};
  }
}

export async function testPrinterSNMP(printerName, ipOverride = null) {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    const infoScript = `
\$printer = Get-WmiObject -Class Win32_Printer | Where-Object { \$_.Name -eq '${escapedName}' } | Select-Object -First 1
if (\$printer) {
    @{ 
        name = \$printer.Name
        port = \$printer.PortName
        driver = \$printer.DriverName
        location = \$printer.Location
    } | ConvertTo-Json
} else {
    @{error = "Printer not found"} | ConvertTo-Json
}
`;

    const info = JSON.parse(await runPowerShell(infoScript));

    if (info.error) {
      return { success: false, error: info.error };
    }

    let printerIp = ipOverride;
    if (!printerIp) {
      printerIp = await discoverPrinterIP(info);
    }

    if (!printerIp) {
      return {
        success: false,
        error: "No IP address found",
        suggestions: [
          "1. Manually provide IP address",
          "2. Check printer network settings",
          "3. Convert WSD port to TCP/IP port",
        ],
      };
    }

    const snmpResult = await testSNMPConnection(printerIp);

    return {
      success: snmpResult.success,
      printerInfo: info,
      ipAddress: printerIp,
      snmpResult: snmpResult,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}