class Logger {
  constructor(verbose = false) {
    this.verbose = verbose || process.env.LOG_VERBOSE === "true";
    this.showPrinterIP = process.env.SHOW_PRINTER_IP === "true";
  }

  // ===== PUBLIC METHODS =====

  info(message) {
    console.log(`📌 ${message}`);
  }

  success(message) {
    console.log(`✅ ${message}`);
  }

  warning(message) {
    console.log(`⚠️ ${message}`);
  }

  error(message) {
    console.log(`❌ ${message}`);
  }

  printer(name, status, ip = "") {
    let icon = "🖨️";
    let statusText = status.toUpperCase();

    switch (statusText) {
      case "PRINTING":
        icon = "🚀";
        break;
      case "ERROR":
        icon = "🔴";
        break;
      case "OFFLINE":
        icon = "⚫";
        break;
      case "PAUSED":
        icon = "⏸️";
        break;
      case "IDLE":
        icon = "💤";
        break;
      case "READY":
        icon = "✅";
        break;
    }

    const ipText = this.showPrinterIP && ip ? ` (${ip})` : "";
    console.log(`${icon} ${name}${ipText}: ${statusText}`);
  }

  ink(name, levels) {
    console.log(`🎨 ${name}:`);
    Object.entries(levels).forEach(([color, percent]) => {
      let icon = "⚪";
      if (percent > 60) icon = "🟢";
      else if (percent > 30) icon = "🟡";
      else if (percent > 10) icon = "🟠";
      else icon = "🔴";

      console.log(`   ${icon} ${color}: ${percent}%`);
    });
  }

  connection(status, endpoint = "") {
    let icon = "🔗";
    if (status === "connected") icon = "✅";
    else if (status === "disconnected") icon = "🔌";
    else if (status === "error") icon = "❌";

    const endpointText = endpoint ? ` (${endpoint})` : "";
    console.log(`${icon} Connection ${status}${endpointText}`);
  }

  monitoring(what, count = 0) {
    console.log(`🔍 Monitoring ${what} (${count} items)`);
  }

  event(type, details = "") {
    if (!this.verbose && type === "debug") return;

    const icons = {
      print: "📄",
      status: "📊",
      ink: "🎨",
      error: "🚨",
      debug: "🐛",
      system: "🖥️",
    };

    const icon = icons[type] || "📌";
    const detailsText = details ? `: ${details}` : "";
    console.log(`${icon} ${type.toUpperCase()}${detailsText}`);
  }

  // ===== VERBOSE LOGGING (only if enabled) =====

  debug(message) {
    if (this.verbose) {
      console.log(`🐛 ${message}`);
    }
  }

  rawData(label, data) {
    if (this.verbose) {
      console.log(`📊 ${label}:`, data);
    }
  }

  wmiOutput(data) {
    if (this.verbose) {
      console.log(`🔧 WMI Output:`, data);
    }
  }
}

// Export singleton instance
const logger = new Logger();
export default logger;
