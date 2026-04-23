import {
  getInkStatus,
  monitorAllPrintersInk,
  testPrinterSNMP,
} from "./ink.service.js";
import { runPowerShell } from "../utils/powershell.js";

export async function runInkTests() {
  const tests = [];

  try {
    const printersScript = `
Get-WmiObject -Class Win32_Printer | 
Where-Object { \$_.Name -notmatch "OneNote|PDF|Fax|Microsoft|XPS" } |
Select-Object Name, PortName, DriverName, PrinterStatus, Location |
ConvertTo-Json
`;

    const output = await runPowerShell(printersScript);
    const printers = JSON.parse(output);

    tests.push({
      name: "List printers",
      success: true,
      count: printers.length,
    });

    for (const printer of printers) {
      try {
        const inkStatus = await getInkStatus(printer.Name);

        tests.push({
          name: `Ink monitoring: ${printer.Name}`,
          success: inkStatus.supported !== undefined,
          supported: inkStatus.supported,
          method: inkStatus.monitoringMethod,
          levels: inkStatus.levels,
          error: inkStatus.error,
        });
      } catch (error) {
        tests.push({
          name: `Ink monitoring: ${printer.Name}`,
          success: false,
          error: error.message,
        });
      }
    }

    try {
      const startTime = Date.now();
      const allInkStatus = await monitorAllPrintersInk();
      const duration = Date.now() - startTime;

      const supportedCount = Object.values(allInkStatus).filter(
        (s) => s.supported,
      ).length;
      const totalCount = Object.keys(allInkStatus).length;

      tests.push({
        name: "Bulk ink monitoring",
        success: true,
        duration: duration,
        total: totalCount,
        supported: supportedCount,
      });
    } catch (error) {
      tests.push({
        name: "Bulk ink monitoring",
        success: false,
        error: error.message,
      });
    }

    const networkPrinters = printers.filter(
      (p) =>
        p.PortName &&
        (p.PortName.match(/IP_|TCP|LPR|WSD/) ||
          p.PortName.match(/\d+\.\d+\.\d+\.\d+/)),
    );

    if (networkPrinters.length > 0) {
      for (const printer of networkPrinters) {
        try {
          let ip = null;

          if (printer.PortName.match(/\d+\.\d+\.\d+\.\d+/)) {
            ip = printer.PortName.match(/\d+\.\d+\.\d+\.\d+/)[0];
          } else if (
            printer.Location &&
            printer.Location.match(/\d+\.\d+\.\d+\.\d+/)
          ) {
            ip = printer.Location.match(/\d+\.\d+\.\d+\.\d+/)[0];
          }

          if (ip) {
            const snmpTest = await testPrinterSNMP(printer.Name, ip);

            tests.push({
              name: `SNMP test: ${printer.Name}`,
              success: snmpTest.success,
              ip: ip,
              printerType: snmpTest.snmpResult?.printerType,
              error: snmpTest.error,
            });
          } else {
            tests.push({
              name: `SNMP test: ${printer.Name}`,
              success: false,
              error: "No IP address found",
              suggestions: [
                "Check printer network settings",
                "Convert WSD port to TCP/IP",
                "Manually configure IP in printer properties",
              ],
            });
          }
        } catch (error) {
          tests.push({
            name: `SNMP test: ${printer.Name}`,
            success: false,
            error: error.message,
          });
        }
      }
    }

    try {
      const wmiTestScript = `
function Get-PrinterCapabilities {
    param(\$PrinterName)
    
    \$printer = Get-WmiObject -Class Win32_Printer | Where-Object { \$_.Name -eq \$PrinterName }
    
    if (-not \$printer) {
        return @{error = "Printer not found"}
    }
    
    \$capabilities = @{
        Name = \$printer.Name
        Capabilities = @()
        ExtendedCapabilities = @()
    }
    
    if (\$printer.Capabilities) {
        \$capabilities.Capabilities = \$printer.Capabilities
    }
    
    \$config = Get-WmiObject -Class Win32_PrinterConfiguration | Where-Object { \$_.Name -eq \$PrinterName }
    if (\$config) {
        \$capabilities.ExtendedCapabilities = \$config | Get-Member -MemberType Property | Select-Object -ExpandProperty Name
    }
    
    return \$capabilities
}

\$firstPrinter = (Get-WmiObject -Class Win32_Printer | Select-Object -First 1).Name
Get-PrinterCapabilities -PrinterName \$firstPrinter | ConvertTo-Json -Depth 3
`;

      const wmiOutput = await runPowerShell(wmiTestScript);
      const wmiResult = JSON.parse(wmiOutput);

      tests.push({
        name: "WMI capabilities check",
        success: true,
        printer: wmiResult.Name,
        capabilities: wmiResult.Capabilities?.length || 0,
      });
    } catch (error) {
      tests.push({
        name: "WMI capabilities check",
        success: false,
        error: error.message,
      });
    }

    const totalTests = tests.length;
    const passedTests = tests.filter((t) => t.success).length;
    const failedTests = totalTests - passedTests;

    return {
      success: failedTests === 0,
      tests: tests,
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runInkTests()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      process.exit(1);
    });
}