import { fetchPrintersRaw } from "./printer.ps.js";
import { normalizePrinter } from "./printer.parser.js";
import { monitorAllPrintersInk } from "../ink/ink.service.js";

let cachedPrinters = [];
let lastCacheTime = null;
const CACHE_DURATION = 30000;

async function updateCacheWithInkStatus(printers, inkStatusData) {
  if (!printers || !inkStatusData) return printers;

  return printers.map((printer) => {
    const printerName = printer.name;
    const inkData = inkStatusData[printerName];

    if (inkData && inkData.supported) {
      const newInkStatus = {
        supported: true,
        levels: inkData.levels ? { ...inkData.levels } : {},
        lastChecked: inkData.lastUpdated || new Date().toISOString(),
        alert: null,
      };

      printer.updateInkStatus(newInkStatus);

      if (inkData.printerInfo?.ipAddress &&
        inkData.printerInfo.ipAddress !== printer.ipAddress) {
        printer.ipAddress = inkData.printerInfo.ipAddress;
      }

      printer.supportsInkMonitoring = true;
      printer.updatedAt = new Date().toISOString();
    } else if (inkData) {
      printer.supportsInkMonitoring = false;
    }

    return printer;
  });
}

export async function getPrinters(forceRefresh = false) {
  return await getPrintersWithInkStatus(forceRefresh);
}

export async function getPrintersWithInkStatus(forceRefresh = false) {
  try {
    if (forceRefresh) {
      cachedPrinters = [];
      lastCacheTime = null;
    }

    if (
      cachedPrinters.length > 0 &&
      lastCacheTime &&
      Date.now() - lastCacheTime < CACHE_DURATION
    ) {
      return cachedPrinters.map(p => p.clone());
    }

    const raw = await fetchPrintersRaw();
    const list = Array.isArray(raw) ? raw : [raw];

    const normalizedPromises = list.map(normalizePrinter);
    let normalizedPrinters = await Promise.all(normalizedPromises);

    normalizedPrinters = normalizedPrinters.filter((p) => p && p.name);

    const inkStatus = await monitorAllPrintersInk();

    const printersWithInk = await updateCacheWithInkStatus(normalizedPrinters, inkStatus);

    cachedPrinters = printersWithInk.map(p => p.clone());
    lastCacheTime = Date.now();

    return printersWithInk.map(p => p.clone());

  } catch (error) {
    try {
      const raw = await fetchPrintersRaw();
      const list = Array.isArray(raw) ? raw : [raw];
      const normalizedPromises = list.map(normalizePrinter);
      const normalizedPrinters = await Promise.all(normalizedPromises);
      const validPrinters = normalizedPrinters.filter((p) => p && p.name);

      cachedPrinters = validPrinters.map(p => p.clone());
      lastCacheTime = Date.now();

      return validPrinters.map(p => p.clone());
    } catch (fallbackError) {
      return [];
    }
  }
}

export async function getPrintersWithoutInk() {
  try {
    const { fetchPrintersRaw } = await import("./printer.ps.js");
    const { normalizePrinters } = await import("./printer.parser.js");

    const raw = await fetchPrintersRaw();
    const printers = await normalizePrinters(raw);

    return printers;
  } catch (error) {
    return [];
  }
}

export async function refreshPrintersWithInkStatus() {
  cachedPrinters = [];
  lastCacheTime = null;
  return await getPrintersWithInkStatus(true);
}

export async function updateSinglePrinterInkStatus(printerName) {
  try {
    const inkStatus = await monitorAllPrintersInk();
    const inkData = inkStatus[printerName];

    if (!inkData) {
      return false;
    }

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

        if (inkData.printerInfo?.ipAddress) {
          printer.ipAddress = inkData.printerInfo.ipAddress;
        }

        printer.supportsInkMonitoring = true;
        printer.updatedAt = new Date().toISOString();

        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

export async function getPrinterByName(name) {
  const printers = await getPrintersWithInkStatus();
  return printers.find((p) => p.name === name);
}

export async function getPrinterByIp(ip) {
  const printers = await getPrintersWithInkStatus();
  return printers.find((p) => p.ipAddress === ip);
}

export async function getNetworkPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isNetwork === true);
}

export async function getLocalPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isNetwork === false);
}

export async function getOnlinePrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isOnline());
}

export async function getOfflinePrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.isOffline());
}

export async function getPrintersWithLowInk() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.hasLowInk());
}

export async function getPrintersWithCriticalInk() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.hasCriticalInk());
}

export async function getPrintersWithInkSupport() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter((p) => p.supportsInkMonitoring === true);
}

export async function refreshPrinters() {
  return await refreshPrintersWithInkStatus();
}

export async function getPrinterCount() {
  const printers = await getPrintersWithInkStatus();
  return printers.length;
}

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
    vendors: {},
    statusCounts: {
      READY: 0,
      PRINTING: 0,
      OFFLINE: 0,
      STOPPED: 0,
      WARMUP: 0,
      UNKNOWN: 0,
      OTHER: 0,
    },
    inkStatus: {
      HEALTHY: 0,
      WARNING: 0,
      CRITICAL: 0,
      UNKNOWN: 0,
    }
  };

  printers.forEach((printer) => {
    const vendor = printer.vendor || "Unknown";
    stats.vendors[vendor] = (stats.vendors[vendor] || 0) + 1;

    const status = printer.status.toUpperCase();
    if (stats.statusCounts[status] !== undefined) {
      stats.statusCounts[status]++;
    } else {
      stats.statusCounts.OTHER++;
    }

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

export async function updatePrinterInkStatus(printerName, inkData) {
  try {
    const printers = await getPrintersWithInkStatus();
    const printerIndex = printers.findIndex((p) => p.name === printerName);

    if (printerIndex === -1) {
      return false;
    }

    printers[printerIndex].updateInkStatus(inkData);

    cachedPrinters = printers.map(p => p.clone());

    return true;
  } catch (error) {
    return false;
  }
}

export async function updatePrinterPageCount(
  printerName,
  pages,
  isToday = true,
) {
  try {
    const printers = await getPrintersWithInkStatus();
    const printerIndex = printers.findIndex((p) => p.name === printerName);

    if (printerIndex === -1) {
      return false;
    }

    printers[printerIndex].updatePageCount(pages, isToday);

    cachedPrinters = printers.map(p => p.clone());

    return true;
  } catch (error) {
    return false;
  }
}

export async function resetDailyCounters() {
  try {
    const printers = await getPrintersWithInkStatus();

    printers.forEach((printer) => {
      printer.resetDailyCounter();
    });

    cachedPrinters = printers.map(p => p.clone());

    return true;
  } catch (error) {
    return false;
  }
}

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

export async function searchPrinters(criteria) {
  const printers = await getPrintersWithInkStatus();

  return printers.filter((printer) => {
    if (!criteria || Object.keys(criteria).length === 0) {
      return true;
    }

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

export function clearCache() {
  cachedPrinters = [];
  lastCacheTime = null;
}

export async function getPrintersByCondition(conditionFn) {
  const printers = await getPrintersWithInkStatus();
  return printers.filter(conditionFn);
}

export async function getProblematicPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter(p =>
    p.isOffline() ||
    p.hasCriticalInk() ||
    (p.recentErrors && p.recentErrors.length > 0)
  );
}

export async function getHealthyPrinters() {
  const printers = await getPrintersWithInkStatus();
  return printers.filter(p =>
    p.isOnline() &&
    !p.hasLowInk() &&
    !p.hasCriticalInk() &&
    (!p.recentErrors || p.recentErrors.length === 0)
  );
}

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