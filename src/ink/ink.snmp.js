import snmp from "net-snmp";

const PRINTER_OIDS = {
    standard: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.2.1.43.11.1.1.9.1.1",
        cyan: "1.3.6.1.2.1.43.11.1.1.9.1.2",
        magenta: "1.3.6.1.2.1.43.11.1.1.9.1.3",
        yellow: "1.3.6.1.2.1.43.11.1.1.9.1.4",
    },

    epson: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.1",
        cyan: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.2",
        magenta: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.3",
        yellow: "1.3.6.1.4.1.1248.1.2.2.1.1.1.3.4",
    },

    samsung: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.2.1.43.11.1.1.9.1.1",
        cyan: "1.3.6.1.2.1.43.11.1.1.9.1.2",
        magenta: "1.3.6.1.2.1.43.11.1.1.9.1.3",
        yellow: "1.3.6.1.2.1.43.11.1.1.9.1.4",
    },

    lexmark: {
        system: "1.3.6.1.2.1.1.1.0",
        pages: "1.3.6.1.2.1.43.10.2.1.4.1.1",
        black: "1.3.6.1.2.1.43.11.1.1.9.1.1",
        cyan: "1.3.6.1.2.1.43.11.1.1.9.1.2",
        magenta: "1.3.6.1.2.1.43.11.1.1.9.1.3",
        yellow: "1.3.6.1.2.1.43.11.1.1.9.1.4",
    },

    alternativePages: [
        "1.3.6.1.2.1.43.10.2.1.4.1.1",
        "1.3.6.1.2.1.25.3.5.1.1.1",
        "1.3.6.1.4.1.11.2.3.9.1.1.7.0",
        "1.3.6.1.2.1.43.10.2.1.5.1.1",
    ]
};

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

    return "standard";
}

function getOIDsForPrinter(brand = "standard", includePages = true) {
    const brandOIDs = PRINTER_OIDS[brand] || PRINTER_OIDS.standard;
    const oids = [];

    oids.push(brandOIDs.system);

    if (brandOIDs.black) oids.push(brandOIDs.black);
    if (brandOIDs.cyan) oids.push(brandOIDs.cyan);
    if (brandOIDs.magenta) oids.push(brandOIDs.magenta);
    if (brandOIDs.yellow) oids.push(brandOIDs.yellow);
    if (brandOIDs.drum) oids.push(brandOIDs.drum);

    if (includePages && brandOIDs.pages) {
        oids.push(brandOIDs.pages);
    }

    return oids;
}

export async function getInkStatusSNMP(printerIp, community = "public") {
    return new Promise((resolve) => {
        const detectSession = snmp.createSession(printerIp, community, {
            timeout: 2000,
            retries: 1,
        });

        detectSession.get(["1.3.6.1.2.1.1.1.0"], (detectError, detectVarbinds) => {
            detectSession.close();

            if (detectError) {
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

            let systemInfo = "";
            let printerBrand = "standard";

            if (detectVarbinds[0] && !snmp.isVarbindError(detectVarbinds[0])) {
                systemInfo = detectVarbinds[0].value.toString();
                printerBrand = detectPrinterBrand(systemInfo);
            }

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

                const results = {
                    system: systemInfo,
                    black: null,
                    cyan: null,
                    magenta: null,
                    yellow: null,
                    drum: null,
                    totalPages: null,
                };

                if (varbinds.length > 1 && varbinds[1] && !snmp.isVarbindError(varbinds[1])) {
                    const val = Number(varbinds[1].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.black = val;
                }

                if (varbinds.length > 2 && varbinds[2] && !snmp.isVarbindError(varbinds[2])) {
                    const val = Number(varbinds[2].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.cyan = val;
                }

                if (varbinds.length > 3 && varbinds[3] && !snmp.isVarbindError(varbinds[3])) {
                    const val = Number(varbinds[3].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.magenta = val;
                }

                if (varbinds.length > 4 && varbinds[4] && !snmp.isVarbindError(varbinds[4])) {
                    const val = Number(varbinds[4].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.yellow = val;
                }

                if (varbinds.length > 5 && varbinds[5] && !snmp.isVarbindError(varbinds[5])) {
                    const val = Number(varbinds[5].value);
                    if (!isNaN(val) && val >= 0 && val <= 100) results.drum = val;
                }

                const pageIndex = queryOIDs.length - 1;
                if (varbinds.length > pageIndex && varbinds[pageIndex] && !snmp.isVarbindError(varbinds[pageIndex])) {
                    const val = Number(varbinds[pageIndex].value);
                    if (!isNaN(val) && val >= 0) results.totalPages = val;
                }

                const inkLevels = {};
                if (results.black !== null) inkLevels.black = results.black;
                if (results.cyan !== null) inkLevels.cyan = results.cyan;
                if (results.magenta !== null) inkLevels.magenta = results.magenta;
                if (results.yellow !== null) inkLevels.yellow = results.yellow;
                if (results.drum !== null) inkLevels.drum = results.drum;

                const hasInkData = Object.keys(inkLevels).length > 0;
                const hasPageData = results.totalPages !== null;
                const supported = hasInkData || hasPageData;

                const warnings = [];
                const criticalWarnings = [];

                Object.entries(inkLevels).forEach(([color, level]) => {
                    if (level <= 10 && color !== 'drum') {
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

                    warnings: warnings,
                    criticalWarnings: criticalWarnings,
                    hasWarnings: warnings.length > 0,
                    hasCriticalWarnings: criticalWarnings.length > 0,

                    inkHealthStatus: criticalWarnings.length > 0 ? "CRITICAL" :
                        warnings.length > 0 ? "WARNING" :
                            hasInkData ? "HEALTHY" : "UNKNOWN",
                });
            });
        });
    });
}

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
                message: `Connected to ${printerBrand.toUpperCase()} printer at ${printerIp}`,
            });
        });
    });
}

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

export async function queryMultiplePrinters(printers, delay = 500) {
    const results = {};

    for (const printer of printers) {
        try {
            const community = printer.community || "public";
            results[printer.name] = await getInkStatusSNMP(printer.ip, community);

            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

        } catch (error) {
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

export default {
    getInkStatusSNMP,
    testSNMPConnection,
    queryMultiplePrinters,
    getPageCounterOnly
};