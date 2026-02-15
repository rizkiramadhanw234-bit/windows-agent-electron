// printer.model.js - FIXED VERSION
export class Printer {
  constructor(data = {}) {
    // PASTIKAN: Setiap printer memiliki ID unik
    this.id = data.id || `${data.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.name = data.name || "";
    this.status = data.status || "unknown";
    this.rawStatus = data.rawStatus || data.PrinterStatus || 0;
    this.shared = data.shared || false;
    this.workOffline = data.workOffline || false;
    this.portName = data.portName || "";
    this.driverName = data.driverName || "";
    this.location = data.location || "";
    this.comment = data.comment || "";
    this.ipAddress = data.ipAddress || null;
    this.isNetwork = data.isNetwork || false;
    this.portType = data.portType || "unknown";
    this.vendor = data.vendor || "unknown";
    this.supportsInkMonitoring = data.supportsInkMonitoring || false;

    // Statistics
    this.totalPages = data.totalPages || 0;
    this.todayPages = data.todayPages || 0;
    this.lastPrintTime = data.lastPrintTime || null;

    // Ink status - PASTIKAN OBJECT BARU SETIAP PRINTER
    this.inkStatus = data.inkStatus || {
      supported: false,
      levels: {},
      lastChecked: null,
      alert: null,
    };

    // PERBAIKAN: Deep copy ink levels jika ada
    if (data.inkStatus && data.inkStatus.levels) {
      this.inkStatus.levels = { ...data.inkStatus.levels };
    }

    // Timestamps
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();

    console.log(`🆕 Created Printer: ${this.name} (ID: ${this.id}) - IP: ${this.ipAddress || 'N/A'}`);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      rawStatus: this.rawStatus,
      shared: this.shared,
      workOffline: this.workOffline,
      portName: this.portName,
      driverName: this.driverName,
      location: this.location,
      comment: this.comment,
      ipAddress: this.ipAddress,
      isNetwork: this.isNetwork,
      portType: this.portType,
      vendor: this.vendor,
      supportsInkMonitoring: this.supportsInkMonitoring,
      totalPages: this.totalPages,
      todayPages: this.todayPages,
      lastPrintTime: this.lastPrintTime,
      inkStatus: this.inkStatus,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromWMI(wmiData) {
    return new Printer({
      name: wmiData.Name || "",
      rawStatus: wmiData.PrinterStatus || 0,
      shared: wmiData.Shared || false,
      workOffline: wmiData.WorkOffline || false,
      portName: wmiData.PortName || "",
      driverName: wmiData.DriverName || "",
      location: wmiData.Location || "",
      comment: wmiData.Comment || "",
    });
  }

  // Status helpers
  isOnline() {
    return (
      this.status === "IDLE" ||
      this.status === "PRINTING" ||
      this.status === "WARMUP"
    );
  }

  isOffline() {
    return this.status === "OFFLINE" || this.workOffline === true;
  }

  isPrinting() {
    return this.status === "PRINTING";
  }

  isPaused() {
    return this.status === "STOPPED";
  }

  hasLowInk() {
    if (!this.inkStatus.supported || !this.inkStatus.levels) {
      return false;
    }

    const lowThreshold = 15;
    return Object.values(this.inkStatus.levels).some(
      (level) => level !== null && level < lowThreshold,
    );
  }

  hasCriticalInk() {
    if (!this.inkStatus.supported || !this.inkStatus.levels) {
      return false;
    }

    const criticalThreshold = 5;
    return Object.values(this.inkStatus.levels).some(
      (level) => level !== null && level < criticalThreshold,
    );
  }

  // Get ink level for specific color
  getInkLevel(color) {
    if (!this.inkStatus.supported || !this.inkStatus.levels) {
      return null;
    }
    return this.inkStatus.levels[color.toLowerCase()] || null;
  }

  // Update ink status - PERBAIKAN: Deep copy levels
  updateInkStatus(inkData) {
    const newInkStatus = {
      ...this.inkStatus,
      ...inkData,
      lastChecked: new Date().toISOString(),
    };

    // Deep copy levels jika ada
    if (inkData.levels) {
      newInkStatus.levels = { ...inkData.levels };
    }

    this.inkStatus = newInkStatus;
    this.updatedAt = new Date().toISOString();

    // Update vendor if detected from ink data
    if (inkData.printerInfo?.vendor) {
      this.vendor = inkData.printerInfo.vendor;
    }
  }

  // Update page count
  updatePageCount(pages, isToday = true) {
    if (isToday) {
      this.todayPages += pages;
    }
    this.totalPages += pages;
    this.lastPrintTime = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  // Reset daily counter
  resetDailyCounter() {
    this.todayPages = 0;
    this.updatedAt = new Date().toISOString();
  }

  // Method untuk copy printer instance (mencegah reference sharing)
  clone() {
    return new Printer(this.toJSON());
  }
}

// Printer status codes mapping
export const PrinterStatusCodes = {
  1: "OTHER",
  2: "UNKNOWN",
  3: "IDLE",
  4: "PRINTING",
  5: "WARMUP",
  6: "STOPPED",
  7: "OFFLINE",
};

// Printer vendors detection
export const PrinterVendors = {
  HP: ["HP", "Hewlett-Packard", "Hewlett Packard"],
  Canon: ["Canon"],
  Epson: ["Epson"],
  Brother: ["Brother"],
  Xerox: ["Xerox"],
  Samsung: ["Samsung"],
  Lexmark: ["Lexmark"],
  Ricoh: ["Ricoh"],
  Kyocera: ["Kyocera"],
  Konica: ["Konica", "Konica Minolta"],
  Sharp: ["Sharp"],
  Toshiba: ["Toshiba"],
  OKI: ["OKI", "Oki Data"],
  Dell: ["Dell"],
};

// Detect vendor from driver name or system info
export function detectVendor(driverName, systemInfo = "") {
  const searchString = (driverName + " " + systemInfo).toLowerCase();

  for (const [vendor, keywords] of Object.entries(PrinterVendors)) {
    for (const keyword of keywords) {
      if (searchString.includes(keyword.toLowerCase())) {
        return vendor;
      }
    }
  }

  return "Unknown";
}