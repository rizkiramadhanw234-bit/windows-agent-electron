// printer.service.js - COMPLETE FIXED VERSION
import { fetchPrintersRaw } from "./printer.ps.js";
import { normalizePrinter } from "./printer.parser.js";
import { monitorAllPrintersInk } from "../ink/ink.service.js";

// Cache printers untuk menghindari query berulang
let cachedPrinters = [];
let lastCacheTime = null;
const CACHE_DURATION = 30000; 

// FUNGSI INTERNAL: Update cache dengan ink status - IMPROVED
async function updateCacheWithInkStatus(printers, inkStatusData) {
  if (!printers || !inkStatusData) return printers;

  console.log(`🔧 Updating ${printers.length} printers with ink status...`);

  return printers.map((printer) => {
    const printerName = printer.name;
    const inkData = inkStatusData[printerName];

    if (inkData && inkData.supported) {
      // Debug sebelum update
      console.log(`🔄 Updating ink for ${printerName}:`, {
        previousIp: printer.ipAddress,
        newIp: inkData.printerInfo?.ipAddress,
        levels: inkData.levels
      });

      // Update ink status dengan deep copy
      const newInkStatus = {
        supported: true,
        levels: inkData.levels ? { ...inkData.levels } : {},
        lastChecked: inkData.lastUpdated || new Date().toISOString(),
        alert: null,
      };

      printer.updateInkStatus(newInkStatus);

      // Update IP address jika ada dan berbeda
      if (inkData.printerInfo?.ipAddress && 
          inkData.printerInfo.ipAddress !== printer.ipAddress) {
        console.log(`🔀 Updating IP for ${printerName}: ${printer.ipAddress} -> ${inkData.printerInfo.ipAddress}`);
        printer.ipAddress = inkData.printerInfo.ipAddress;
      }

      // Update supportsInkMonitoring
      printer.supportsInkMonitoring = true;

      // Update timestamp
      printer.updatedAt = new Date().toISOString();
      
      console.log(`✅ Updated ink status for ${printerName}`);
      
      // Debug setelah update
      console.log(`📊 ${printerName} ink levels:`, printer.inkStatus.levels);
    } else if (inkData) {
      console.log(`ℹ️ ${printerName}: Ink monitoring not supported`);
      printer.supportsInkMonitoring = false;
    }

    return printer;
  });
}

// FUNGSI UTAMA: Get printers DENGAN ink status - FIXED
export async function getPrinters(forceRefresh = false) {
  return await getPrintersWithInkStatus(forceRefresh);
}

// FUNGSI BARU: Get printers dengan ink status terupdate - IMPROVED
export async function getPrintersWithInkStatus(forceRefresh = false) {
  try {
    // Debug cache status
    const cacheStatus = getCacheStatus();
    console.log('📦 Cache status:', cacheStatus);

    // Clear cache jika force refresh
    if (forceRefresh) {
      cachedPrinters = [];
      lastCacheTime = null;
      console.log('🔄 Force refresh requested, clearing cache');
    }
    
    // Return cache jika masih valid
    if (
      cachedPrinters.length > 0 &&
      lastCacheTime &&
      Date.now() - lastCacheTime < CACHE_DURATION
    ) {
      console.log(`🔄 Returning cached printers (${cachedPrinters.length} printers)`);
      
      // Debug cached printers
      cachedPrinters.forEach((p, i) => {
        console.log(`   [${i}] ${p.name} - IP: ${p.ipAddress} - Ink:`, p.inkStatus?.levels);
      });
      
      // Return clone of cached printers untuk menghindari reference sharing
      return cachedPrinters.map(p => p.clone());
    }

    console.log("🖨️ Fetching printers from Windows...");
    
    // 1. Get raw printer data
    const raw = await fetchPrintersRaw();
    const list = Array.isArray(raw) ? raw : [raw];

    console.log(`📊 Raw printers count: ${list.length}`);

    // Debug raw data
    list.forEach((p, i) => {
      console.log(`   [${i}] ${p.Name} - ${p.PortName} - ${p.Location || 'No Location'}`);
    });

    // 2. Normalize printer data
    const normalizedPromises = list.map(normalizePrinter);
    let normalizedPrinters = await Promise.all(normalizedPromises);

    // Filter out invalid printers
    normalizedPrinters = normalizedPrinters.filter((p) => p && p.name);

    console.log(`✅ Normalized ${normalizedPrinters.length} printer(s)`);

    // 3. Get ink status untuk semua printer - HANYA untuk network printers
    console.log("🎨 Getting ink status for all printers...");
    const inkStatus = await monitorAllPrintersInk();
    
    // Debug ink status
    console.log('📈 Ink status results:', Object.keys(inkStatus).length);
    Object.entries(inkStatus).forEach(([name, data]) => {
      console.log(`   ${name}: ${data.supported ? 'Supported' : 'Not supported'}`, data.levels);
    });

    // 4. Update printers dengan ink status
    const printersWithInk = await updateCacheWithInkStatus(normalizedPrinters, inkStatus);

    // 5. Update cache dengan deep copy
    cachedPrinters = printersWithInk.map(p => p.clone());
    lastCacheTime = Date.now();

    console.log(`✅ Successfully retrieved ${printersWithInk.length} printer(s) with ink status`);
    
    // Debug: Show sample printer
    if (printersWithInk.length > 0) {
      const sample = printersWithInk[0];
      console.log("📋 Sample printer data:");
      console.log(JSON.stringify(sample.toJSON(), null, 2));
    }

    return printersWithInk.map(p => p.clone());
    
  } catch (error) {
    console.error("❌ Error getting printers with ink status:", error);
    
    // Fallback: coba tanpa ink status
    try {
      console.log("🔄 Fallback: Trying to get printers without ink status...");
      const raw = await fetchPrintersRaw();
      const list = Array.isArray(raw) ? raw : [raw];
      const normalizedPromises = list.map(normalizePrinter);
      const normalizedPrinters = await Promise.all(normalizedPromises);
      const validPrinters = normalizedPrinters.filter((p) => p && p.name);
      
      // Update cache dengan fallback data
      cachedPrinters = validPrinters.map(p => p.clone());
      lastCacheTime = Date.now();
      
      return validPrinters.map(p => p.clone());
    } catch (fallbackError) {
      console.error("❌ Fallback also failed:", fallbackError);
      return [];
    }
  }
}

// Fungsi untuk mendapatkan printer tanpa ink status (cepat)
export async function getPrintersWithoutInk() {
  try {
    const { fetchPrintersRaw } = await import("./printer.ps.js");
    const { normalizePrinters } = await import("./printer.parser.js");
    
    const raw = await fetchPrintersRaw();
    const printers = await normalizePrinters(raw);
    
    return printers;
  } catch (error) {
    console.error("Error getting printers without ink:", error);
    return [];
  }
}

// FUNGSI BARU: Force refresh dengan ink status
export async function refreshPrintersWithInkStatus() {
  cachedPrinters = [];
  lastCacheTime = null;
  return await getPrintersWithInkStatus(true);
}

// FUNGSI BARU: Update ink status untuk printer tertentu
export async function updateSinglePrinterInkStatus(printerName) {
  try {
    // Get current ink status untuk printer ini
    const inkStatus = await monitorAllPrintersInk();
    const inkData = inkStatus[printerName];
    
    if (!inkData) {
      console.log(`ℹ️ No ink data available for ${printerName}`);
      return false;
    }
    
    // Update cache jika ada
    const printerIndex = cachedPrinters.findIndex(p => p.name === printerName);
    if (printerIndex !== -1) {
      const printer = cachedPrinters[printerIndex];
      
      if (inkData.supported) {
        const newInkStatus = {
          supported: true,
          levels: inkData.levels ? { ...inkData.levels } : {},
          lastChecked: inkData.lastUpdated || new Date().toISOString(),
          alert: null,
        };
        
        printer.updateInkStatus(newInkStatus);
        
        // Update IP address jika ada
        if (inkData.printerInfo?.ipAddress) {
          printer.ipAddress = inkData.printerInfo.ipAddress;
        }
        
        printer.supportsInkMonitoring = true;
        printer.updatedAt = new Date().toISOString();
        
        console.log(`✅ Updated ink status for ${printerName} in cache`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error updating ink status for ${printerName}:`, error);
    return false;
  }
}

// Fungsi helper untuk mendapatkan printer tunggal DENGAN ink status
export async function getPrinterByName(name) {
  const printers = await getPrintersWithInkStatus();
  return printers.find((p) => p.name === name);
}

// Fungsi untuk mendapatkan printer berdasarkan IP
export async function getPrinterByIp(ip) {
  const printers = await getPrintersWithInkStatus();
  return printers.find((p) => p.ipAddress === ip);
}

// Fungsi untuk mendapatkan printer network saja
export async function getNetworkPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isNetwork === true);
}

// Fungsi untuk mendapatkan printer local saja
export async function getLocalPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isNetwork === false);
}

// Fungsi untuk mendapatkan printer online saja
export async function getOnlinePrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isOnline());
}

// Fungsi untuk mendapatkan printer offline saja
export async function getOfflinePrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isOffline());
}

// Fungsi untuk mendapatkan printer dengan low ink
export async function getPrintersWithLowInk() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.hasLowInk());
}

// Fungsi untuk mendapatkan printer dengan critical ink
export async function getPrintersWithCriticalInk() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.hasCriticalInk());
}

// Fungsi untuk mendapatkan printer dengan ink monitoring support
export async function getPrintersWithInkSupport() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.supportsInkMonitoring === true);
}

// Fungsi untuk refresh cache (alias untuk backward compatibility)
export async function refreshPrinters() {
  return await refreshPrintersWithInkStatus();
}

// Fungsi untuk mendapatkan jumlah printer
export async function getPrinterCount() {
  const printers = await getPrintersWithInkStatus();
  return printers.length;
}

// Fungsi untuk mendapatkan statistik printer
export async function getPrinterStats() {
  const printers = await getPrintersWithInkStatus();

  const stats = {
    total: printers.length,
    network: printers.filter((p) => p.isNetwork).length,
    local: printers.filter((p) => !p.isNetwork).length,
    online: printers.filter((p) => p.isOnline()).length,
    offline: printers.filter((p) => p.isOffline()).length,
    printing: printers.filter((p) => p.isPrinting()).length,
    paused: printers.filter((p) => p.isPaused()).length,
    shared: printers.filter((p) => p.shared).length,
    withLowInk: printers.filter((p) => p.hasLowInk()).length,
    withCriticalInk: printers.filter((p) => p.hasCriticalInk()).length,
    withInkSupport: printers.filter((p) => p.supportsInkMonitoring).length,

    // Vendor distribution
    vendors: {},

    // Status distribution
    statusCounts: {
      READY: 0,
      PRINTING: 0,
      OFFLINE: 0,
      STOPPED: 0,
      WARMUP: 0,
      UNKNOWN: 0,
      OTHER: 0,
    },
    
    // Ink status distribution
    inkStatus: {
      HEALTHY: 0,
      WARNING: 0,
      CRITICAL: 0,
      UNKNOWN: 0,
    }
  };

  // Count vendors and statuses
  printers.forEach((printer) => {
    // Count vendor
    const vendor = printer.vendor || "Unknown";
    stats.vendors[vendor] = (stats.vendors[vendor] || 0) + 1;

    // Count printer status
    const status = printer.status.toUpperCase();
    if (stats.statusCounts[status] !== undefined) {
      stats.statusCounts[status]++;
    } else {
      stats.statusCounts.OTHER++;
    }
    
    // Count ink status
    if (printer.inkStatus?.supported) {
      if (printer.hasCriticalInk()) {
        stats.inkStatus.CRITICAL++;
      } else if (printer.hasLowInk()) {
        stats.inkStatus.WARNING++;
      } else {
        stats.inkStatus.HEALTHY++;
      }
    } else {
      stats.inkStatus.UNKNOWN++;
    }
  });

  return stats;
}

// Fungsi untuk update ink status printer tertentu (untuk manual update)
export async function updatePrinterInkStatus(printerName, inkData) {
  try {
    const printers = await getPrintersWithInkStatus();
    const printerIndex = printers.findIndex((p) => p.name === printerName);

    if (printerIndex === -1) {
      console.error(`❌ Printer ${printerName} not found for ink status update`);
      return false;
    }

    printers[printerIndex].updateInkStatus(inkData);

    // Update cache
    cachedPrinters = printers.map(p => p.clone());

    console.log(`✅ Updated ink status for ${printerName}`);
    return true;
  } catch (error) {
    console.error(`❌ Error updating ink status for ${printerName}:`, error);
    return false;
  }
}

// Fungsi untuk update page count printer
export async function updatePrinterPageCount(
  printerName,
  pages,
  isToday = true,
) {
  try {
    const printers = await getPrintersWithInkStatus();
    const printerIndex = printers.findIndex((p) => p.name === printerName);

    if (printerIndex === -1) {
      console.error(`❌ Printer ${printerName} not found for page count update`);
      return false;
    }

    printers[printerIndex].updatePageCount(pages, isToday);

    // Update cache
    cachedPrinters = printers.map(p => p.clone());

    console.log(`✅ Updated page count for ${printerName}: +${pages} pages`);
    return true;
  } catch (error) {
    console.error(`❌ Error updating page count for ${printerName}:`, error);
    return false;
  }
}

// Fungsi untuk reset daily counters
export async function resetDailyCounters() {
  try {
    const printers = await getPrintersWithInkStatus();

    printers.forEach((printer) => {
      printer.resetDailyCounter();
    });

    // Update cache
    cachedPrinters = printers.map(p => p.clone());

    console.log(`✅ Reset daily counters for ${printers.length} printer(s)`);
    return true;
  } catch (error) {
    console.error(`❌ Error resetting daily counters:`, error);
    return false;
  }
}

// Fungsi untuk mendapatkan printer dalam format sederhana untuk UI
export async function getPrintersSimple() {
  const printers = await getPrintersWithInkStatus();

  return printers.map((printer) => ({
    id: printer.id || printer.name.replace(/\s+/g, "-").toLowerCase(),
    name: printer.name,
    status: printer.status,
    rawStatus: printer.rawStatus,
    isOnline: printer.isOnline(),
    isOffline: printer.isOffline(),
    isPrinting: printer.isPrinting(),
    isNetwork: printer.isNetwork,
    ipAddress: printer.ipAddress,
    vendor: printer.vendor,
    totalPages: printer.totalPages,
    todayPages: printer.todayPages,
    hasLowInk: printer.hasLowInk(),
    hasCriticalInk: printer.hasCriticalInk(),
    lastPrintTime: printer.lastPrintTime,
    inkStatus: printer.inkStatus,
    supportsInkMonitoring: printer.supportsInkMonitoring,
    healthStatus: printer.healthStatus || 'UNKNOWN',
    healthSeverity: printer.healthSeverity || 'INFO',
  }));
}

// Fungsi untuk mencari printer berdasarkan kriteria
export async function searchPrinters(criteria) {
  const printers = await getPrintersWithInkStatus();

  return printers.filter((printer) => {
    // Jika tidak ada kriteria, kembalikan semua
    if (!criteria || Object.keys(criteria).length === 0) {
      return true;
    }

    // Filter berdasarkan setiap kriteria
    let match = true;

    if (criteria.name) {
      match =
        match &&
        printer.name.toLowerCase().includes(criteria.name.toLowerCase());
    }

    if (criteria.status) {
      match = match && printer.status === criteria.status;
    }

    if (criteria.healthStatus) {
      match = match && (printer.healthStatus || 'UNKNOWN') === criteria.healthStatus;
    }

    if (criteria.isNetwork !== undefined) {
      match = match && printer.isNetwork === criteria.isNetwork;
    }

    if (criteria.vendor) {
      match = match && printer.vendor === criteria.vendor;
    }

    if (criteria.hasLowInk !== undefined) {
      match = match && printer.hasLowInk() === criteria.hasLowInk;
    }

    if (criteria.hasCriticalInk !== undefined) {
      match = match && printer.hasCriticalInk() === criteria.hasCriticalInk;
    }

    if (criteria.ipAddress) {
      match = match && printer.ipAddress === criteria.ipAddress;
    }

    if (criteria.supportsInkMonitoring !== undefined) {
      match = match && printer.supportsInkMonitoring === criteria.supportsInkMonitoring;
    }

    return match;
  });
}

// Export untuk debug cache
export function getCacheStatus() {
  return {
    cachedPrintersCount: cachedPrinters.length,
    lastCacheTime: lastCacheTime ? new Date(lastCacheTime).toISOString() : null,
    cacheAge: lastCacheTime ? Date.now() - lastCacheTime : null,
    cacheValid: cachedPrinters.length > 0 && lastCacheTime && 
               (Date.now() - lastCacheTime) < CACHE_DURATION,
    printers: cachedPrinters.map(p => ({
      name: p.name,
      ip: p.ipAddress,
      inkLevels: p.inkStatus?.levels
    }))
  };
}

// Export untuk clear cache
export function clearCache() {
  cachedPrinters = [];
  lastCacheTime = null;
  console.log("🧹 Cache cleared");
}

// Export untuk mendapatkan printers berdasarkan kondisi
export async function getPrintersByCondition(conditionFn) {
  const printers = await getPrintersWithInkStatus();
  return printers.filter(conditionFn);
}

// Export untuk mendapatkan printer dengan masalah
export async function getProblematicPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter(p => 
    p.isOffline() || 
    p.hasCriticalInk() || 
    (p.recentErrors && p.recentErrors.length > 0)
  );
}

// Export untuk mendapatkan printer sehat
export async function getHealthyPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter(p => 
    p.isOnline() && 
    !p.hasLowInk() && 
    !p.hasCriticalInk() &&
    (!p.recentErrors || p.recentErrors.length === 0)
  );
}

// Export untuk mendapatkan printers dengan detail lengkap
export async function getPrintersDetailed() {
  const printers = await getPrintersWithInkStatus();
  return printers.map(p => ({
    ...p.toJSON(),
    systemStatus: {
      isOnline: p.isOnline(),
      isPrinting: p.isPrinting(),
      isOffline: p.isOffline(),
      hasIssues: p.hasLowInk() || p.hasCriticalInk() || p.isOffline(),
      issues: [
        p.hasCriticalInk() ? 'Critical ink level' : null,
        p.hasLowInk() ? 'Low ink level' : null,
        p.isOffline() ? 'Printer offline' : null,
        (p.recentErrors && p.recentErrors.length > 0) ? 'Recent errors' : null
      ].filter(Boolean)
    },
    lastUpdated: p.updatedAt,
    cacheAge: lastCacheTime ? Date.now() - lastCacheTime : null
  }));
}

// Export semua fungsi
export default {
  getPrinters,
  getPrintersWithInkStatus,
  getPrintersWithoutInk,
  refreshPrintersWithInkStatus,
  updateSinglePrinterInkStatus,
  getPrinterByName,
  getPrinterByIp,
  getNetworkPrinters,
  getLocalPrinters,
  getOnlinePrinters,
  getOfflinePrinters,
  getPrintersWithLowInk,
  getPrintersWithCriticalInk,
  getPrintersWithInkSupport,
  refreshPrinters,
  getPrinterCount,
  getPrinterStats,
  updatePrinterInkStatus,
  updatePrinterPageCount,
  resetDailyCounters,
  getPrintersSimple,
  searchPrinters,
  getCacheStatus,
  clearCache,
  getPrintersByCondition,
  getProblematicPrinters,
  getHealthyPrinters,
  getPrintersDetailed,
};