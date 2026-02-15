import {
  getInkStatus,
  monitorAllPrintersInk,
  testPrinterSNMP,
} from "./ink.service.js";
import { runPowerShell } from "../utils/powershell.js";

export async function runInkTests() {
  console.log("\n" + "=".repeat(60));
  console.log("🖨️ PRINTER INK MONITORING TEST SUITE");
  console.log("=".repeat(60) + "\n");

  const tests = [];

  // Test 1: Get all printers
  console.log("🔍 Test 1: Listing all printers...");
  try {
    const printersScript = `
Get-WmiObject -Class Win32_Printer | 
Where-Object { \$_.Name -notmatch "OneNote|PDF|Fax|Microsoft|XPS" } |
Select-Object Name, PortName, DriverName, PrinterStatus, Location |
ConvertTo-Json
`;

    const output = await runPowerShell(printersScript);
    const printers = JSON.parse(output);

    console.log(`✅ Found ${printers.length} printers:\n`);
    printers.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.Name}`);
      console.log(`      Port: ${p.PortName}`);
      console.log(`      Driver: ${p.DriverName}`);
      console.log(`      Status: ${p.PrinterStatus}`);
      if (p.Location) console.log(`      Location: ${p.Location}`);
      console.log();
    });

    tests.push({
      name: "List printers",
      success: true,
      count: printers.length,
    });

    // Test 2: Test ink monitoring on each printer
    console.log("🎯 Test 2: Testing ink monitoring on each printer...\n");

    for (const printer of printers) {
      console.log(`🖨️ Testing: ${printer.Name}`);
      console.log(`   Port: ${printer.PortName}`);

      try {
        const inkStatus = await getInkStatus(printer.Name);

        console.log(
          `   Result: ${inkStatus.supported ? "✅ SUPPORTED" : "❌ NOT SUPPORTED"}`,
        );
        console.log(`   Method: ${inkStatus.monitoringMethod || "N/A"}`);

        if (inkStatus.supported && inkStatus.levels) {
          console.log(`   Ink Levels:`);
          Object.entries(inkStatus.levels).forEach(([color, level]) => {
            const icon = level < 20 ? "⚠️" : level < 50 ? "🔸" : "✅";
            console.log(`     ${icon} ${color}: ${level}%`);
          });
        }

        if (inkStatus.error) {
          console.log(`   Error: ${inkStatus.error}`);
        }

        if (inkStatus.message) {
          console.log(`   Message: ${inkStatus.message}`);
        }

        if (inkStatus.printerInfo?.ipAddress) {
          console.log(`   IP Address: ${inkStatus.printerInfo.ipAddress}`);
        }

        tests.push({
          name: `Ink monitoring: ${printer.Name}`,
          success: inkStatus.supported !== undefined,
          supported: inkStatus.supported,
          method: inkStatus.monitoringMethod,
          levels: inkStatus.levels,
          error: inkStatus.error,
        });
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        tests.push({
          name: `Ink monitoring: ${printer.Name}`,
          success: false,
          error: error.message,
        });
      }

      console.log();
    }

    // Test 3: Bulk ink monitoring
    console.log("🚀 Test 3: Bulk ink monitoring (all printers)...\n");
    try {
      const startTime = Date.now();
      const allInkStatus = await monitorAllPrintersInk();
      const duration = Date.now() - startTime;

      const supportedCount = Object.values(allInkStatus).filter(
        (s) => s.supported,
      ).length;
      const totalCount = Object.keys(allInkStatus).length;

      console.log(`✅ Bulk monitoring completed in ${duration}ms`);
      console.log(`   Total printers: ${totalCount}`);
      console.log(`   Supported: ${supportedCount}`);
      console.log(`   Not supported: ${totalCount - supportedCount}`);

      tests.push({
        name: "Bulk ink monitoring",
        success: true,
        duration: duration,
        total: totalCount,
        supported: supportedCount,
      });
    } catch (error) {
      console.log(`❌ Bulk monitoring failed: ${error.message}`);
      tests.push({
        name: "Bulk ink monitoring",
        success: false,
        error: error.message,
      });
    }

    // Test 4: SNMP test for network printers
    console.log(
      "\n🌐 Test 4: SNMP connectivity test for network printers...\n",
    );

    const networkPrinters = printers.filter(
      (p) =>
        p.PortName &&
        (p.PortName.match(/IP_|TCP|LPR|WSD/) ||
          p.PortName.match(/\d+\.\d+\.\d+\.\d+/)),
    );

    if (networkPrinters.length > 0) {
      console.log(`Found ${networkPrinters.length} network printers:\n`);

      for (const printer of networkPrinters) {
        console.log(`🔍 Testing SNMP for: ${printer.Name}`);

        try {
          // Extract IP from PortName or Location
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
            console.log(`   IP Address: ${ip}`);

            const snmpTest = await testPrinterSNMP(printer.Name, ip);

            if (snmpTest.success) {
              console.log(
                `   ✅ SNMP Connected: ${snmpTest.snmpResult.printerType}`,
              );
              console.log(
                `   System Info: ${snmpTest.snmpResult.systemInfo.substring(0, 80)}...`,
              );
            } else {
              console.log(
                `   ❌ SNMP Failed: ${snmpTest.error || "Unknown error"}`,
              );
              if (snmpTest.suggestions) {
                snmpTest.suggestions.forEach((s) => console.log(`      ${s}`));
              }
            }

            tests.push({
              name: `SNMP test: ${printer.Name}`,
              success: snmpTest.success,
              ip: ip,
              printerType: snmpTest.snmpResult?.printerType,
              error: snmpTest.error,
            });
          } else {
            console.log(`   ⚠️ No IP address found for network printer`);
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
          console.log(`   ❌ SNMP test error: ${error.message}`);
          tests.push({
            name: `SNMP test: ${printer.Name}`,
            success: false,
            error: error.message,
          });
        }

        console.log();
      }
    } else {
      console.log("No network printers found to test.\n");
    }

    // Test 5: WMI ink check
    console.log("🖥️ Test 5: WMI ink status check...\n");
    try {
      const wmiTestScript = `
function Get-PrinterCapabilities {
    param(\$PrinterName)
    
    \$printer = Get-WmiObject -Class Win32_Printer | Where-Object { \$_.Name -eq \$PrinterName }
    
    if (-not \$printer) {
        return @{error = "Printer not found"}
    }
    
    # Check for extended properties
    \$capabilities = @{
        Name = \$printer.Name
        Capabilities = @()
        ExtendedCapabilities = @()
    }
    
    # Standard capabilities
    if (\$printer.Capabilities) {
        \$capabilities.Capabilities = \$printer.Capabilities
    }
    
    # Try to get more info from Win32_PrinterConfiguration
    \$config = Get-WmiObject -Class Win32_PrinterConfiguration | Where-Object { \$_.Name -eq \$PrinterName }
    if (\$config) {
        \$capabilities.ExtendedCapabilities = \$config | Get-Member -MemberType Property | Select-Object -ExpandProperty Name
    }
    
    return \$capabilities
}

# Test on first printer
\$firstPrinter = (Get-WmiObject -Class Win32_Printer | Select-Object -First 1).Name
Get-PrinterCapabilities -PrinterName \$firstPrinter | ConvertTo-Json -Depth 3
`;

      const wmiOutput = await runPowerShell(wmiTestScript);
      const wmiResult = JSON.parse(wmiOutput);

      console.log(`WMI Capabilities for: ${wmiResult.Name}`);
      console.log(`Capabilities count: ${wmiResult.Capabilities?.length || 0}`);
      console.log(
        `Extended properties: ${wmiResult.ExtendedCapabilities?.length || 0}`,
      );

      tests.push({
        name: "WMI capabilities check",
        success: true,
        printer: wmiResult.Name,
        capabilities: wmiResult.Capabilities?.length || 0,
      });
    } catch (error) {
      console.log(`WMI test error: ${error.message}`);
      tests.push({
        name: "WMI capabilities check",
        success: false,
        error: error.message,
      });
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 TEST SUMMARY");
    console.log("=".repeat(60));

    const totalTests = tests.length;
    const passedTests = tests.filter((t) => t.success).length;
    const failedTests = totalTests - passedTests;

    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);

    if (failedTests > 0) {
      console.log("\n❌ Failed tests:");
      tests
        .filter((t) => !t.success)
        .forEach((t, i) => {
          console.log(`   ${i + 1}. ${t.name}`);
          if (t.error) console.log(`      Error: ${t.error}`);
        });
    }

    // Recommendations
    console.log("\n💡 RECOMMENDATIONS:");
    console.log(
      "1. For network printers: Enable SNMP on printer web interface",
    );
    console.log(
      "2. For USB printers: Check if vendor software provides ink monitoring",
    );
    console.log(
      "3. For WSD printers: Convert to TCP/IP port for better monitoring",
    );
    console.log("4. Ensure firewall allows SNMP (UDP 161) and ICMP (ping)");

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
    console.error(`❌ Test suite failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Command line interface
if (import.meta.url === `file://${process.argv[1]}`) {
  runInkTests()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
