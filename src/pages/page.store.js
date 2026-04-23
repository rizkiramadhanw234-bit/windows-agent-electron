import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDataFilePath() {
    const userDataPathArg = process.argv.find(arg => arg.startsWith('--user-data-path='));
    if (userDataPathArg) {
        return path.join(userDataPathArg.split('=')[1], 'pages.json');
    }

    if (process.env.USER_DATA_PATH) {
        return path.join(process.env.USER_DATA_PATH, 'pages.json');
    }

    if (process.cwd().includes('AppData\\Local\\Programs')) {
        const appDataPath = path.join(process.env.APPDATA || '', 'printer-agent-desktop');
        if (!existsSync(appDataPath)) {
            mkdirSync(appDataPath, { recursive: true });
        }
        return path.join(appDataPath, 'pages.json');
    }

    return path.join(__dirname, '../../data/pages.json');
}

const DATA_FILE = getDataFilePath();

try {
    const dir = path.dirname(DATA_FILE);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(DATA_FILE)) {
        const initialData = {
            printers: {},
            metadata: {
                version: "2.0",
                created: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            }
        };
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
    }
} catch (error) {
    // Error handled silently
}

function cleanJsonContent(content) {
    if (!content || content.trim() === '') return '{}';
    return content.replace(/^\uFEFF/, '').trim();
}

async function readJsonFile() {
    try {
        const content = await fs.readFile(DATA_FILE, 'utf8');
        const cleanContent = cleanJsonContent(content);
        return JSON.parse(cleanContent);
    } catch (error) {
        return { printers: {}, metadata: { version: "2.0", created: new Date().toISOString() } };
    }
}

async function writeJsonFile(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        return false;
    }
}

export async function addPages(printer, pages, options = {}) {
    try {
        const { isColor = false, colorPages = 0, bwPages = 0 } = options;

        const normalizedPrinter = printer
            .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/g, '')
            .replace(/^\[CANON\s*WSD\]\s*/gi, '')
            .replace(/^\[CANON\]\s*/gi, '')
            .replace(/^\[[^\]]*\]\s*/g, '')
            .trim();

        const data = await readJsonFile();
        const today = new Date().toISOString().split('T')[0];

        if (!data.printers) data.printers = {};
        if (!data.printers[normalizedPrinter]) {
            data.printers[normalizedPrinter] = {
                totalLifetime: 0,
                daily: {},
                lastUpdated: new Date().toISOString()
            };
        }

        if (!data.printers[normalizedPrinter].daily[today]) {
            data.printers[normalizedPrinter].daily[today] = {
                windowsSpooler: 0,
                colorPages: 0,
                bwPages: 0,
                timestamp: new Date().toISOString()
            };
        }

        if (!data.printers[normalizedPrinter].daily[today].colorPages) {
            data.printers[normalizedPrinter].daily[today].colorPages = 0;
        }
        if (!data.printers[normalizedPrinter].daily[today].bwPages) {
            data.printers[normalizedPrinter].daily[today].bwPages = 0;
        }

        data.printers[normalizedPrinter].daily[today].windowsSpooler += pages;
        data.printers[normalizedPrinter].daily[today].colorPages += colorPages;
        data.printers[normalizedPrinter].daily[today].bwPages += bwPages;

        data.printers[normalizedPrinter].totalLifetime += pages;
        data.printers[normalizedPrinter].lastUpdated = new Date().toISOString();

        if (!data.metadata) data.metadata = {};
        data.metadata.lastUpdated = new Date().toISOString();
        data.metadata.totalPrinters = Object.keys(data.printers).length;

        await writeJsonFile(data);

        return {
            success: true,
            printer: normalizedPrinter,
            pages,
            today: data.printers[normalizedPrinter].daily[today],
            totalLifetime: data.printers[normalizedPrinter].totalLifetime,
            date: today,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function getDailyReport(dateStr = null) {
    try {
        const data = await readJsonFile();
        const targetDate = dateStr || new Date().toISOString().split('T')[0];

        let totalPages = 0;
        const printers = [];

        for (const [printerName, printerData] of Object.entries(data.printers || {})) {
            const dailyData = printerData.daily?.[targetDate];

            if (dailyData) {
                const spooler = dailyData.windowsSpooler || 0;
                totalPages += spooler;

                printers.push({
                    name: printerName,
                    pages: spooler,
                    spoolerPages: spooler,
                    totalLifetime: printerData.totalLifetime || 0,
                    lastUpdated: printerData.lastUpdated
                });
            }
        }

        printers.sort((a, b) => b.pages - a.pages);

        return {
            success: true,
            date: targetDate,
            totalPages: totalPages,
            spoolerPages: totalPages,
            printers: printers,
            count: printers.length,
            timestamp: new Date().toISOString(),
            dataSource: "windows-print-spooler",
            note: "Data from Windows Print Spooler only (this PC)",
            sources: {
                windowsSpooler: {
                    enabled: true,
                    pages: totalPages,
                    reliability: "high",
                    note: "Real-time Windows print jobs"
                },
            }
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            date: dateStr || new Date().toISOString().split('T')[0],
            totalPages: 0,
            printers: [],
            count: 0,
            timestamp: new Date().toISOString(),
            note: "Error retrieving data"
        };
    }
}

export function getPrinterCache() { return new Map(); }
export function setPrinterCache() { }
export function clearPrinterCache() { }
export async function updatePrinterTotalPages() {
    return { success: false, message: "Printer SNMP disabled" };
}
export async function syncPrinterPages() {
    return { success: false, message: "Printer SNMP disabled" };
}

export async function cleanupOldData(daysToKeep = 30) {
    try {
        const data = await readJsonFile();

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];

        let cleanedCount = 0;

        for (const [printerName, printerData] of Object.entries(data.printers || {})) {
            if (printerData.daily) {
                for (const date in printerData.daily) {
                    if (date < cutoffStr) {
                        delete printerData.daily[date];
                        cleanedCount++;
                    }
                }

                if (Object.keys(printerData.daily).length === 0 &&
                    (!printerData.totalLifetime || printerData.totalLifetime === 0)) {
                    delete data.printers[printerName];
                }
            }
        }

        if (cleanedCount > 0) {
            await writeJsonFile(data);
        }

        return {
            success: true,
            cleaned: cleanedCount,
            daysKept: daysToKeep,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

export async function resetDailyCounters() {
    try {
        const data = await readJsonFile();
        const today = new Date().toISOString().split('T')[0];

        if (!data.metadata) data.metadata = {};
        data.metadata.lastReset = new Date().toISOString();
        data.metadata.dailyReset = today;

        await writeJsonFile(data);

        return {
            success: true,
            date: today,
            reset: true,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

export const storeAddPages = addPages;

function setupDailyReset() {
    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

    if (nextReset <= now) {
        nextReset.setDate(nextReset.getDate() + 1);
    }

    const timeUntilReset = nextReset.getTime() - now.getTime();

    setTimeout(async () => {
        try {
            await fs.access(DATA_FILE);
            await resetDailyCounters();
        } catch (error) {
            setTimeout(setupDailyReset, 60000);
            return;
        }
        setupDailyReset();
    }, timeUntilReset);
}

setTimeout(() => {
    setupDailyReset();
}, 10000);