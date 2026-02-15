// ink.snmp.js - FIXED VERSION WITH DYNAMIC OID DETECTION
import snmp from "net-snmp";

// OID Library untuk berbagai printer brand
const PRINTER_OIDS = {
    // Standard OIDs (HP, Canon, Xerox, Brother, etc.)
    standard: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.2.1.43.11.1.1.9.1.1",
        cyan: "1.3.6.1.2.1.43.11.1.1.9.1.2",
        magenta: "1.3.6.1.2.1.43.11.1.1.9.1.3",
        yellow: "1.3.6.1.2.1.43.11.1.1.9.1.4",
        drum: "1.3.6.1.2.1.43.11.1.1.8.1.1",
    },

    // Epson OIDs
    epson: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.1",
        cyan: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.2",
        magenta: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.3",
        yellow: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.4",
    },

    // Samsung OIDs
    samsung: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.2.1.43.11.1.1.9.1.1",
        cyan: "1.3.6.1.2.1.43.11.1.1.9.1.2",
        magenta: "1.3.6.1.2.1.43.11.1.1.9.1.3",
        yellow: "1.3.6.1.2.1.43.11.1.1.9.1.4",
    },

    // Lexmark OIDs
    lexmark: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.2.1.43.11.1.1.9.1.1",
        cyan: "1.3.6.1.2.1.43.11.1.1.9.1.2",
        magenta: "1.3.6.1.2.1.43.11.1.1.9.1.3",
        yellow: "1.3.6.1.2.1.43.11.1.1.9.1.4",
    },

    // Alternative page counters
    alternativePages: [
        "1.3.6.1.2.1.43.10.2.1.4.1.1", // Standard HP/Canon/Xerox
        "1.3.6.1.2.1.25.3.5.1.1.1",    // Generic
        "1.3.6.1.4.1.11.2.3.9.1.1.7.0", // HP LaserJet
        "1.3.6.1.2.1.43.10.2.1.5.1.1", // Alternative
    ]
};

// Detect printer brand dari system info
function detectPrinterBrand(systemInfo) {
    if (!systemInfo) return "standard";

    const info = systemInfo.toLowerCase();

    if (info.includes("epson")) return "epson";
    if (info.includes("samsung")) return "samsung";
    if (info.includes("lexmark")) return "lexmark";
    if (info.includes("brother")) return "standard";
    if (info.includes("canon")) return "standard";
    if (info.includes("xerox")) return "standard";
    if (info.includes("hp") || info.includes("hewlett")) return "standard";

    return "standard"; // Default to standard OIDs
}

// Get OIDs berdasarkan printer brand
function getOIDsForPrinter(brand = "standard", includePages = true) {
    const brandOIDs = PRINTER_OIDS[brand] || PRINTER_OIDS.standard;
    const oids = [];

    // Always include system OID
    oids.push(brandOIDs.system);

    // Include color OIDs
    if (brandOIDs.black) oids.push(brandOIDs.black);
    if (brandOIDs.cyan) oids.push(brandOIDs.cyan);
    if (brandOIDs.magenta) oids.push(brandOIDs.magenta);
    if (brandOIDs.yellow) oids.push(brandOIDs.yellow);
    if (brandOIDs.drum) oids.push(brandOIDs.drum);

    // Include page counter
    if (includePages && brandOIDs.pages) {
        oids.push(brandOIDs.pages);
    }

    return oids;
}

// Main SNMP function - SIMPLE & RELIABLE
export async function getInkStatusSNMP(printerIp, community = "public") {
    console.log(`🎯 SNMP Query to ${printerIp}`);

    return new Promise((resolve) => {
        // STEP 1: First detect printer type dengan query minimal
        const detectSession = snmp.createSession(printerIp, community, {
            timeout: 2000,
            retries: 1,
        });

        detectSession.get(["1.3.6.1.2.1.1.1.0"], (detectError, detectVarbinds) => {
            detectSession.close();

            if (detectError) {
                console.log(`❌ SNMP detection failed for ${printerIp}:`, detectError.message);
                resolve({
                    supported: false,
                    error: detectError.message,
                    levels: {},
                    totalPages: null,
                    systemInfo: null,
                    message: `SNMP not accessible: ${detectError.message}`,
                });
                return;
            }

            // Get system info
            let systemInfo = "";
            let printerBrand = "standard";

            if (detectVarbinds[0] && !snmp.isVarbindError(detectVarbinds[0])) {
                systemInfo = detectVarbinds[0].value.toString();
                printerBrand = detectPrinterBrand(systemInfo);

                console.log(`📋 ${printerIp}: ${printerBrand.toUpperCase()} printer detected`);
                if (systemInfo.length > 60) {
                    console.log(`   System: ${systemInfo.substring(0, 60)}...`);
                } else {
                    console.log(`   System: ${systemInfo}`);
                }
            }

            // STEP 2: Query dengan OID yang sesuai
            const queryOIDs = getOIDsForPrinter(printerBrand, true);

            const querySession = snmp.createSession(printerIp, community, {
                timeout: 3000,
                retries: 1,
                port: 161,
                transport: "udp4",
            });

            querySession.get(queryOIDs, (queryError, varbinds) => {
                querySession.close();

                if (queryError) {
                    console.log(`❌ SNMP query failed for ${printerIp}:`, queryError.message);
                    resolve({
                        supported: false,
                        error: queryError.message,
                        levels: {},
                        totalPages: null,
                        systemInfo: systemInfo,
                        printerType: printerBrand,
                        message: `SNMP query failed: ${queryError.message}`,
                    });
                    return;
                }

                // Process results
                const results = {
                    system: systemInfo,
                    black: null,
                    cyan: null,
                    magenta: null,
                    yellow: null,
                    drum: null,
                    totalPages: null,
                };

                // Parse varbinds based on OID count
                // Index 0 selalu system info (sudah kita punya)

                // Black toner (index 1 jika ada)
                if (varbinds.length > 1 && varbinds[1] && !snmp.isVarbindError(varbinds[1])) {
                    const val = Number(varbinds[1].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.black = val;
                }

                // Cyan toner (index 2 jika ada)
                if (varbinds.length > 2 && varbinds[2] && !snmp.isVarbindError(varbinds[2])) {
                    const val = Number(varbinds[2].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.cyan = val;
                }

                // Magenta toner (index 3 jika ada)
                if (varbinds.length > 3 && varbinds[3] && !snmp.isVarbindError(varbinds[3])) {
                    const val = Number(varbinds[3].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.magenta = val;
                }

                // Yellow toner (index 4 jika ada)
                if (varbinds.length > 4 && varbinds[4] && !snmp.isVarbindError(varbinds[4])) {
                    const val = Number(varbinds[4].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.yellow = val;
                }

                // Drum unit (index 5 jika ada)
                if (varbinds.length > 5 && varbinds[5] && !snmp.isVarbindError(varbinds[5])) {
                    const val = Number(varbinds[5].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.drum = val;
                }

                // Total pages (last OID)
                const pageIndex = queryOIDs.length - 1;
                if (varbinds.length > pageIndex && varbinds[pageIndex] && !snmp.isVarbindError(varbinds[pageIndex])) {
                    const val = Number(varbinds[pageIndex].value);
                    if (!isNaN(val) && val >= 0) results.totalPages = val;
                }

                // Build ink levels object
                const inkLevels = {};
                if (results.black !== null) inkLevels.black = results.black;
                if (results.cyan !== null) inkLevels.cyan = results.cyan;
                if (results.magenta !== null) inkLevels.magenta = results.magenta;
                if (results.yellow !== null) inkLevels.yellow = results.yellow;
                if (results.drum !== null) inkLevels.drum = results.drum;

                const hasInkData = Object.keys(inkLevels).length > 0;
                const hasPageData = results.totalPages !== null;
                const supported = hasInkData || hasPageData;

                // Log results
                console.log(`📈 SNMP results for ${printerIp}:`);
                console.log(`   Brand: ${printerBrand.toUpperCase()}`);
                console.log(`   Supported: ${supported}`);
                console.log(`   Has ink: ${hasInkData} (${Object.keys(inkLevels).length} items)`);
                console.log(`   Total pages: ${results.totalPages || 0}`);

                if (hasInkData) {
                    console.log(`   Ink levels:`, inkLevels);
                }

                // Auto-pause warnings
                const warnings = [];
                const criticalWarnings = [];

                Object.entries(inkLevels).forEach(([color, level]) => {
                    if (level <= 10 && color !== 'drum') { // drum biasanya persentase berbeda
                        criticalWarnings.push({
                            color,
                            level,
                            message: `${color} ink CRITICALLY LOW: ${level}%`,
                        });
                    } else if (level <= 20 && color !== 'drum') {
                        warnings.push({
                            color,
                            level,
                            message: `${color} ink low: ${level}%`,
                        });
                    }
                });

                // Build message
                let message = "";
                if (hasInkData && hasPageData) {
                    message = `SNMP successful: ${Object.keys(inkLevels).length} toner levels, ${results.totalPages} total pages`;
                } else if (hasInkData) {
                    message = `SNMP ink monitoring successful (${Object.keys(inkLevels).length} colors detected)`;
                } else if (hasPageData) {
                    message = `Page counter available: ${results.totalPages} total pages`;
                } else {
                    message = "Printer responds but no usable data via SNMP";
                }

                if (criticalWarnings.length > 0) {
                    message += ` - ${criticalWarnings.length} CRITICAL warnings`;
                } else if (warnings.length > 0) {
                    message += ` - ${warnings.length} warnings`;
                }

                resolve({
                    supported: supported,
                    levels: inkLevels,
                    totalPages: results.totalPages,
                    systemInfo: systemInfo,
                    printerType: printerBrand,
                    printerBrand: printerBrand,
                    lastUpdated: new Date().toISOString(),
                    message: message,

                    // Warning system
                    warnings: warnings,
                    criticalWarnings: criticalWarnings,
                    hasWarnings: warnings.length > 0,
                    hasCriticalWarnings: criticalWarnings.length > 0,

                    // Health status
                    inkHealthStatus: criticalWarnings.length > 0 ? "CRITICAL" :
                        warnings.length > 0 ? "WARNING" :
                            hasInkData ? "HEALTHY" : "UNKNOWN",
                });
            });
        });
    });
}

// Test function - SIMPLE
export async function testSNMPConnection(printerIp, community = "public") {
    return new Promise((resolve) => {
        const session = snmp.createSession(printerIp, community, {
            timeout: 2000,
            retries: 1,
        });

        session.get(["1.3.6.1.2.1.1.1.0"], (error, varbinds) => {
            session.close();

            if (error) {
                resolve({
                    success: false,
                    error: error.message,
                    message: `Cannot connect to ${printerIp} via SNMP`,
                    suggestions: [
                        "1. Enable SNMP on printer web interface",
                        "2. Check firewall allows UDP port 161",
                        "3. Verify printer IP address",
                        "4. Try community string: 'public' or 'private'",
                    ],
                });
                return;
            }

            const systemInfo = varbinds[0].value.toString();
            const printerBrand = detectPrinterBrand(systemInfo);

            resolve({
                success: true,
                systemInfo: systemInfo,
                printerType: printerBrand,
                message: `✅ Connected to ${printerBrand.toUpperCase()} printer at ${printerIp}`,
            });
        });
    });
}

// Function khusus untuk page counter saja
export async function getPageCounterOnly(printerIp, community = "public") {
    return new Promise((resolve) => {
        const session = snmp.createSession(printerIp, community, {
            timeout: 2000,
            retries: 1,
        });

        const pageOids = PRINTER_OIDS.alternativePages;

        session.get(pageOids, (error, varbinds) => {
            session.close();

            if (error) {
                resolve({
                    success: false,
                    totalPages: null,
                    error: error.message
                });
                return;
            }

            let totalPages = null;

            for (let i = 0; i < varbinds.length; i++) {
                if (!snmp.isVarbindError(varbinds[i])) {
                    const pages = Number(varbinds[i].value);
                    if (!isNaN(pages) && pages >= 0) {
                        totalPages = pages;
                        break;
                    }
                }
            }

            resolve({
                success: totalPages !== null,
                totalPages: totalPages,
                timestamp: new Date().toISOString()
            });
        });
    });
}

// Bulk query dengan delay
export async function queryMultiplePrinters(printers, delay = 500) {
    const results = {};

    console.log(`\n🔍 Bulk SNMP query for ${printers.length} printers...`);

    for (const printer of printers) {
        try {
            console.log(`   Querying ${printer.name} (${printer.ip})...`);

            const community = printer.community || "public";
            results[printer.name] = await getInkStatusSNMP(printer.ip, community);

            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

        } catch (error) {
            console.log(`   ❌ Error querying ${printer.name}: ${error.message}`);
            results[printer.name] = {
                supported: false,
                error: error.message,
                levels: {},
                totalPages: null,
                message: `SNMP query failed: ${error.message}`
            };
        }
    }

    return results;
}

// Export all functions
export default {
    getInkStatusSNMP,
    testSNMPConnection,
    queryMultiplePrinters,
    getPageCounterOnly
};