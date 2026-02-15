// pages/page.store.js - VERSI SIMPLE
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = "C:/Scripts/printer-dashboard/data/pages.json";

// Helper untuk handle BOM character
function cleanJsonContent(content) {
    if (!content || content.trim() === '') return '{}';
    // Remove BOM character jika ada
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
        return {};
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

// ==================== FUNGSI UTAMA ====================

// Add pages function
export async function addPages(printer, pages) {
    try {
        const data = await readJsonFile();
        const today = new Date().toISOString().split('T')[0];

        // Initialize jika belum ada
        if (!data[printer]) {
            data[printer] = {};
        }
        if (!data[printer][today]) {
            data[printer][today] = 0;
        }

        // Tambah pages
        data[printer][today] += pages;
        const total = data[printer][today];

        // Simpan
        await writeJsonFile(data);
        
        return {
            success: true,
            printer,
            pages,
            total,
            date: today
        };
    } catch (error) {
        console.error("Error adding pages:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get daily report
export async function getDailyReport(dateStr = null) {
    try {
        const data = await readJsonFile();
        const targetDate = dateStr || new Date().toISOString().split('T')[0];
        
        let totalPages = 0;
        const printers = [];
        
        for (const [printerName, dates] of Object.entries(data)) {
            if (dates[targetDate]) {
                const pages = dates[targetDate];
                totalPages += pages;
                printers.push({
                    name: printerName,
                    pages: pages
                });
            }
        }
        
        return {
            success: true,
            date: targetDate,
            totalPages: totalPages,
            printers: printers,
            count: printers.length,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error getting daily report:", error);
        return {
            success: false,
            error: error.message,
            date: dateStr || new Date().toISOString().split('T')[0],
            totalPages: 0,
            printers: [],
            count: 0
        };
    }
}

// Debug data
export async function debugData() {
    try {
        return await readJsonFile();
    } catch (error) {
        console.error("Debug error:", error);
        return null;
    }
}

// Cleanup old data - HANYA SATU FUNGSI INI!
export async function cleanupOldData(daysToKeep = 30) {
    try {
        const data = await readJsonFile();
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];
        
        let cleaned = false;
        
        for (const [printer, dates] of Object.entries(data)) {
            for (const date in dates) {
                if (date < cutoffStr) {
                    delete data[printer][date];
                    cleaned = true;
                }
            }
            // Remove printer if no dates left
            if (Object.keys(data[printer]).length === 0) {
                delete data[printer];
            }
        }
        
        if (cleaned) {
            await writeJsonFile(data);
            console.log(`🧹 Cleaned data older than ${daysToKeep} days`);
        }
        
        return true;
    } catch (error) {
        console.error("Cleanup error:", error.message);
        return false;
    }
}

// Alias untuk backward compatibility
export const storeAddPages = addPages;