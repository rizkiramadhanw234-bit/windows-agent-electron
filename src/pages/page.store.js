import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'pages.json')
    : path.join(__dirname, '../../data/pages.json');

console.log('📁 DATA_FILE path:', DATA_FILE);

try {
    const dir = path.dirname(DATA_FILE);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log('📁 Created directory:', dir);
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
        console.log('✅ Created pages.json');
    }
} catch (error) {
    console.error('❌ Failed to create data file:', error.message);
}

console.log('📁 DATA_FILE path:', DATA_FILE);

// Helper untuk handle BOM character
function cleanJsonContent(content) {
    if (!content || content.trim() === '') return '{}';
    return content.replace(/^\uFEFF/, '').trim();
}

// Baca JSON file dengan error handling
async function readJsonFile() {
    try {
        const content = await fs.readFile(DATA_FILE, 'utf8');
        const cleanContent = cleanJsonContent(content);
        return JSON.parse(cleanContent);
    } catch (error) {
        console.warn(`⚠️ Could not read ${DATA_FILE}: ${error.message}`);
        return { printers: {}, metadata: { version: "2.0", created: new Date().toISOString() } };
    }
}

// Tulis JSON file
async function writeJsonFile(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`❌ Could not write ${DATA_FILE}: ${error.message}`);
        return false;
    }
}

/**
 * Add pages dari Windows Spooler
 */
export async function addPages(printer, pages, source = "windows-spooler") {
    try {
        const data = await readJsonFile();
        const today = new Date().toISOString().split('T')[0];

        // Initialize structure
        if (!data.printers) data.printers = {};
        if (!data.printers[printer]) {
            data.printers[printer] = {
                totalLifetime: 0,
                daily: {},
                lastUpdated: new Date().toISOString()
            };
        }

        if (!data.printers[printer].daily[today]) {
            data.printers[printer].daily[today] = {
                windowsSpooler: 0,
                timestamp: new Date().toISOString()
            };
        }

        // Add pages (hanya Windows Spooler)
        data.printers[printer].daily[today].windowsSpooler += pages;
        console.log(`📄 ${printer}: +${pages} pages (Windows Spooler)`);

        // Update total lifetime
        data.printers[printer].totalLifetime += pages;
        data.printers[printer].lastUpdated = new Date().toISOString();

        // Update metadata
        if (!data.metadata) data.metadata = {};
        data.metadata.lastUpdated = new Date().toISOString();
        data.metadata.totalPrinters = Object.keys(data.printers).length;

        // Save
        await writeJsonFile(data);

        return {
            success: true,
            printer,
            pages,
            source,
            today: data.printers[printer].daily[today],
            totalLifetime: data.printers[printer].totalLifetime,
            date: today,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error("❌ Error adding pages:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get enhanced daily report (Print Spooler only)
 */
export async function getDailyReport(dateStr = null) {
    try {
        const data = await readJsonFile();
        const targetDate = dateStr || new Date().toISOString().split('T')[0];

        let totalPages = 0;
        const printers = [];

        // Process each printer
        for (const [printerName, printerData] of Object.entries(data.printers || {})) {
            const dailyData = printerData.daily?.[targetDate];

            if (dailyData) {
                const spooler = dailyData.windowsSpooler || 0;
                totalPages += spooler;

                printers.push({
                    name: printerName,
                    pages: spooler,
                    spoolerPages: spooler,
                    // printerPages: 0, // Always 0 karena tidak pakai printer SNMP
                    totalLifetime: printerData.totalLifetime || 0,
                    lastUpdated: printerData.lastUpdated
                });
            }
        }

        // Sort by pages (descending)
        printers.sort((a, b) => b.pages - a.pages);

        return {
            success: true,
            date: targetDate,

            // Summary
            totalPages: totalPages,
            spoolerPages: totalPages,
            // printerPages: 0, // Always 0
            // combinedPages: totalPages,

            // Detailed data
            printers: printers,
            count: printers.length,

            // Metadata
            timestamp: new Date().toISOString(),
            dataSource: "windows-print-spooler",
            note: "Data from Windows Print Spooler only (this PC)",

            // Source breakdown
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
        console.error("❌ Error getting daily report:", error);
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

// Hapus semua fungsi SNMP dan printer counter
export function getPrinterCache() { return new Map(); }
export function setPrinterCache() { }
export function clearPrinterCache() { }
export async function updatePrinterTotalPages() {
    return { success: false, message: "Printer SNMP disabled" };
}
export async function syncPrinterPages() {
    console.log("⚠️ Printer SNMP sync disabled");
    return { success: false, message: "Printer SNMP disabled" };
}

/**
 * Cleanup old data
 */
export async function cleanupOldData(daysToKeep = 30) {
    try {
        const data = await readJsonFile();

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];

        let cleanedCount = 0;

        // Cleanup daily data
        for (const [printerName, printerData] of Object.entries(data.printers || {})) {
            if (printerData.daily) {
                for (const date in printerData.daily) {
                    if (date < cutoffStr) {
                        delete printerData.daily[date];
                        cleanedCount++;
                    }
                }

                // Remove printer jika tidak ada data sama sekali
                if (Object.keys(printerData.daily).length === 0 &&
                    (!printerData.totalLifetime || printerData.totalLifetime === 0)) {
                    delete data.printers[printerName];
                }
            }
        }

        if (cleanedCount > 0) {
            await writeJsonFile(data);
            console.log(`🧹 Cleaned ${cleanedCount} old daily records`);
        }

        return {
            success: true,
            cleaned: cleanedCount,
            daysKept: daysToKeep,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error("❌ Cleanup error:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Reset daily counters (run at midnight)
 */
export async function resetDailyCounters() {
    try {
        const data = await readJsonFile();
        const today = new Date().toISOString().split('T')[0];

        // Update metadata
        if (!data.metadata) data.metadata = {};
        data.metadata.lastReset = new Date().toISOString();
        data.metadata.dailyReset = today;

        await writeJsonFile(data);

        console.log(`🔄 Daily counters reset for ${today}`);

        return {
            success: true,
            date: today,
            reset: true,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error("❌ Reset error:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Alias untuk backward compatibility
export const storeAddPages = addPages;

// Setup daily reset at midnight
function setupDailyReset() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    console.log(`⏰ Next daily reset scheduled for: ${midnight.toLocaleTimeString()}`);

    setTimeout(async () => {
        try {
            // Cek apakah file sudah ada sebelum reset
            await fs.access(DATA_FILE);
            await resetDailyCounters();
            console.log(`✅ Daily counters reset for ${new Date().toISOString().split('T')[0]}`);
        } catch (error) {
            console.log(`⏭️ Skipping reset (file not ready): ${error.message}`);
            // Coba lagi dalam 1 menit
            setTimeout(setupDailyReset, 60000);
            return;
        }
        setupDailyReset(); // Setup next reset
    }, timeUntilMidnight);
}

// Initialize daily reset dengan delay
setTimeout(() => {
    console.log("🔧 Initializing daily reset scheduler...");
    setupDailyReset();
}, 10000);

// Initialize daily reset
setupDailyReset();