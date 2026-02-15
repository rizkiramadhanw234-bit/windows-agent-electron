// ink.service.js - OPTIMIZED WITH NODE.JS SNMP (FIXED VERSION)
import { getInkStatusSNMP, testSNMPConnection } from "./ink.snmp.js";
import { getInkStatusWMI } from "./ink.wmi.js";
import { runPowerShell } from "../utils/powershell.js";

// Cache untuk menghindari terlalu sering polling
const inkCache = new Map();
const CACHE_TTL = 30000; // 30 detik

// Function untuk extract IP dari berbagai sumber
async function discoverPrinterIP(printerInfo) {
  let ip = null;

  console.log(`🔍 Discovering IP for printer: ${printerInfo.Name}`);
  console.log(`   PortName: ${printerInfo.PortName}`);
  console.log(`   Location: ${printerInfo.Location}`);

  // 1. Cari IPv4 dari PortName (prioritas tertinggi)
  if (printerInfo.PortName) {
    const ipv4MatchPort = printerInfo.PortName.match(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    );
    if (ipv4MatchPort) {
      ip = ipv4MatchPort[0];
      console.log(`📍 Found IPv4 in PortName: ${ip}`);
      return ip; // Return langsung karena IPv4 lebih prefer
    }
  }

  // 2. Cari IPv4 dari Location (prioritas kedua)
  if (printerInfo.Location) {
    // Prioritaskan IPv4
    const ipv4MatchLocation = printerInfo.Location.match(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    );
    if (ipv4MatchLocation) {
      ip = ipv4MatchLocation[0];
      console.log(`📍 Found IPv4 in Location: ${ip}`);
      return ip;
    }

    // Jika tidak ada IPv4, baru cari IPv6
    const ipv6Match = printerInfo.Location.match(/\[([0-9a-fA-F:]+)\]/);
    if (ipv6Match) {
      ip = ipv6Match[1];
      console.log(`📍 Found IPv6 in Location: ${ip}`);
      return ip;
    }
  }

  // 3. Untuk WSD printers, coba extract hostname
  if (!ip && printerInfo.PortName && printerInfo.PortName.startsWith("WSD")) {
    console.log(`🔍 WSD printer detected: ${printerInfo.Name}`);

    // Coba extract dari Location URL
    if (printerInfo.Location && printerInfo.Location.includes("http://")) {
      try {
        const url = new URL(printerInfo.Location);
        const hostname = url.hostname;

        // Jika hostname adalah IPv6 (dalam brackets)
        if (hostname.startsWith("[") && hostname.endsWith("]")) {
          ip = hostname.slice(1, -1);
          console.log(`📍 Extracted IPv6 from WSD URL: ${ip}`);
          return ip;
        }
        // Jika hostname adalah IPv4
        else if (hostname.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)) {
          ip = hostname;
          console.log(`📍 Extracted IPv4 from WSD URL: ${ip}`);
          return ip;
        }
      } catch (error) {
        // URL parsing failed
      }
    }

    // Coba ping hostname
    const hostMatch = printerInfo.Name.match(/^([^\(]+)/);
    if (hostMatch) {
      const hostname = hostMatch[1].trim();
      console.log(`🔍 Trying to resolve WSD printer hostname: ${hostname}`);

      const pingScript = `
\$hostname = '${hostname}'
try {
    \$ping = Test-Connection -ComputerName \$hostname -Count 1 -ErrorAction SilentlyContinue
    if (\$ping) {
        # Prioritaskan IPv4
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
          console.log(`📍 Resolved WSD hostname to IP: ${ip}`);
        }
      } catch (error) {
        console.log(`⚠️ Ping failed for ${hostname}: ${error.message}`);
      }
    }
  }

  // 4. Coba metode lain untuk WSD
  if (!ip && printerInfo.PortName && printerInfo.PortName.startsWith("WSD")) {
    // Untuk WSD printer, coba decode Device Path
    console.log(`🔍 WSD printer detected: ${printerInfo.Name}`);

    const wsdScript = `
\$printerName = '${printerInfo.Name.replace(/'/g, "''")}'
try {
    # Gunakan Get-Printer untuk mendapatkan DevicePath
    \$wsdPrinter = Get-Printer -Name \$printerName | Select-Object Name, DeviceType, PortName, DriverName, ComputerName, Location, DevicePath
    
    if (\$wsdPrinter) {
        \$devicePath = \$wsdPrinter.DevicePath
        
        # Extract IP dari DevicePath atau Location
        if (\$devicePath -and \$devicePath -match 'http://([^:]+)') {
            \$hostPart = \$matches[1]
            
            # Jika IPv6 dalam brackets
            if (\$hostPart -match '^\[(.*)\]$') {
                \$ip = \$matches[1]
                Write-Output \$ip
                exit
            }
            # Jika langsung hostname/IP
            else {
                # Coba resolve ke IP
                \$ip = [System.Net.Dns]::GetHostAddresses(\$hostPart) | 
                       Where-Object { \$_.AddressFamily -eq 'InterNetwork' } | 
                       Select-Object -First 1 -ExpandProperty IPAddressToString
                
                if (\$ip) {
                    Write-Output \$ip
                    exit
                }
            }
        }
        
        # Fallback: Cari di WSD Registry
        \$regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\SWD\\PRINTENUM"
        if (Test-Path \$regPath) {
            \$wsdEntries = Get-ChildItem -Path \$regPath -ErrorAction SilentlyContinue
            
            foreach (\$entry in \$wsdEntries) {
                \$friendlyName = Get-ItemProperty -Path \$entry.PSPath -Name "FriendlyName" -ErrorAction SilentlyContinue
                if (\$friendlyName -and \$friendlyName.FriendlyName -eq \$printerName) {
                    \$deviceId = Get-ItemProperty -Path \$entry.PSPath -Name "DeviceID" -ErrorAction SilentlyContinue
                    if (\$deviceId) {
                        # Extract IP dari DeviceID
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
        
        # Last resort: Gunakan Location URL
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
        console.log(`📍 Found IP for WSD printer: ${ip}`);
      } else {
        console.log(`⚠️ Could not find IP for WSD printer: ${printerInfo.Name}`);
      }
    } catch (error) {
      console.log(`⚠️ WSD IP discovery failed: ${error.message}`);
    }
  }

  if (!ip) {
    console.log(`❌ No IP address found for printer: ${printerInfo.Name}`);
  }

  return ip;
}

export async function getInkStatus(printerName) {
  console.log(`\n🎯 getInkStatus for: "${printerName}"`);

  const cacheKey = `${printerName}_${Date.now()}`;
  const cached = inkCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 Using cached data for ${printerName}`);
    return cached.data;
  }

  try {
    // 1. Get printer info via WMI
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

    // Debug printer info
    console.log('🔍 DEBUG: Printer Info:', {
      name: printerInfo.Name,
      port: printerInfo.PortName,
      location: printerInfo.Location,
      isNetwork: printerInfo.IsNetwork
    });

    // 2. Determine monitoring method
    if (printerInfo.IsNetwork) {
      printerIp = await discoverPrinterIP(printerInfo);

      if (printerIp) {
        console.log(`🌐 Network printer detected: ${printerName}`);
        console.log(`   IP Address: ${printerIp}`);
        console.log(`   IP Type: ${printerIp.includes(":") ? "IPv6" : "IPv4"}`);

        method = "SNMP";

        // Try SNMP with timeout
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

        // Debug SNMP result
        console.log('📊 SNMP Result:', {
          supported: inkData.supported,
          hasLevels: !!inkData.levels,
          systemInfo: inkData.systemInfo ? inkData.systemInfo.substring(0, 50) + '...' : 'None'
        });

        if (!inkData.supported) {
          console.log(`🔄 SNMP failed, falling back to WMI...`);
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

    // 3. Check for low ink warnings
    const warnings = [];
    const criticalWarnings = [];

    if (inkData.levels) {
      Object.entries(inkData.levels).forEach(([color, level]) => {
        if (level !== null) {
          if (level <= 15) {
            // LOW INK WARNING 15%
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

    // 4. Determine ink health status
    let inkHealthStatus = "HEALTHY";
    if (criticalWarnings.length > 0) {
      inkHealthStatus = "CRITICAL";
    } else if (warnings.length > 0) {
      inkHealthStatus = "WARNING";
    } else if (!inkData.supported) {
      inkHealthStatus = "UNSUPPORTED";
    }

    // 5. Prepare final result
    const finalResult = {
      ...inkData,
      printer: printerName,
      lastChecked: new Date().toISOString(),
      monitoringMethod: method,
      printerInfo: {
        ...printerInfo,
        ipAddress: printerIp,
      },

      // Ink warning system
      warnings: warnings,
      criticalWarnings: criticalWarnings,
      hasWarnings: warnings.length > 0,
      hasCriticalWarnings: criticalWarnings.length > 0,
      inkHealthStatus: inkHealthStatus,

      // Summary
      warningSummary:
        warnings.length > 0
          ? `${warnings.length} ink warning(s)`
          : "All ink levels normal",
    };

    console.log(
      `✅ ${printerName}: ${inkData.supported ? "SUPPORTED" : "NOT SUPPORTED"} (${method}) - ${finalResult.warningSummary}`,
    );

    // Log warnings if any
    if (warnings.length > 0) {
      warnings.forEach((warning) => {
        console.log(`   ⚠️ ${warning.severity}: ${warning.message}`);
      });
    }

    // 6. Cache result
    inkCache.set(cacheKey, {
      timestamp: Date.now(),
      data: finalResult,
    });

    return finalResult;
  } catch (error) {
    console.error(`💥 Error for ${printerName}:`, error.message);

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
  console.log(`\n🚀 STARTING INK MONITORING CYCLE`);

  try {
    // Get all printers
    const printersScript = `
Get-WmiObject -Class Win32_Printer | 
Where-Object { \$_.Name -notmatch "OneNote|PDF|Fax|Microsoft|XPS" } |
Select-Object Name, PortName, DriverName, PrinterStatus |
ConvertTo-Json
`;

    const output = await runPowerShell(printersScript);

    if (!output || output.trim() === "") {
      console.log("⚠️ No printers found or empty output");
      return {};
    }

    let printers;
    try {
      printers = JSON.parse(output);
      if (!Array.isArray(printers)) {
        printers = [printers];
      }
    } catch (parseError) {
      console.error(
        "❌ Failed to parse printers JSON:",
        output.substring(0, 200),
      );
      console.error("Parse error:", parseError.message);
      return {};
    }

    console.log(`📊 Found ${printers.length} printers to monitor`);

    const results = {};

    // Process printers sequentially untuk debugging
    for (let i = 0; i < printers.length; i++) {
      const printer = printers[i];
      console.log(
        `🔍 [${i+1}/${printers.length}] Processing: ${printer.Name} (${printer.PrinterStatus === 3 ? "Ready" : "Other"})`,
      );
      results[printer.Name] = await getInkStatus(printer.Name);
      
      // Delay antara printer
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Summary
    const total = Object.keys(results).length;
    const supported = Object.values(results).filter((r) => r.supported).length;
    const warnings = Object.values(results).filter((r) => r.hasWarnings).length;
    const critical = Object.values(results).filter(
      (r) => r.hasCriticalWarnings,
    ).length;

    console.log(`\n📈 INK MONITORING SUMMARY:`);
    console.log(`   Total printers: ${total}`);
    console.log(`   Supported: ${supported}`);
    console.log(`   Not supported: ${total - supported}`);
    console.log(`   ⚠️ Warnings: ${warnings}`);
    console.log(`   🚨 Critical: ${critical}`);

    return results;
  } catch (error) {
    console.error("💥 Monitoring error:", error);
    return {};
  }
}

// Utility function untuk manual SNMP test
export async function testPrinterSNMP(printerName, ipOverride = null) {
  console.log(`\n🧪 MANUAL SNMP TEST for ${printerName}`);

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

    console.log(`🔍 Testing SNMP to ${printerIp}...`);
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