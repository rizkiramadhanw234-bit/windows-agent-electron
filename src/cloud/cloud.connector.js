import WebSocket from "ws";
import os from "os";
import { getConfig } from "../../config-manager.js";

export class CloudConnector {
  constructor() {
    const config = getConfig();

    if (!config) {
      console.error("❌ Agent not configured. Please register first.");
      throw new Error("Agent not configured");
    }

    this.ws = null;
    this.reconnectInterval = 5000;
    this.maxReconnectAttempts = 10;
    this.reconnectAttempts = 0;

    this.agentId = config.agentId;
    this.agentName = config.hostname || "Windows Agent";
    this.agentLocation = config.location || "Unknown";
    this.customerId = config.customAgentId || config.agentId;

    this.cloudUrl = config.websocketUrl;
    this.apiKey = config.apiKey || "windows_agent_key_123";

    console.log("🔑 CloudConnector initialized:");
    console.log("   Agent ID:", this.agentId);
    console.log("   WebSocket URL:", this.cloudUrl);
    console.log("   API Key:", this.apiKey.substring(0, 10) + "...");

    this.deviceInfo = this.getDeviceInfo();
    this.isConnected = false;
    this.heartbeatInterval = null;
  }

  getDeviceInfo() {
    return {
      agentId: this.agentId,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      macAddress: this.getMacAddress(),
      ip: this.getLocalIP(),
      timestamp: new Date().toISOString(),
      location: this.agentLocation,
    };
  }

  getMacAddress() {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            return iface.mac;
          }
        }
      }
    } catch (error) {
      console.error('Error getting MAC address:', error);
    }
    return 'unknown';
  }

  getLocalIP() {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
    } catch (error) {
      console.error('Error getting IP:', error);
    }
    return '127.0.0.1';
  }

  connect() {
    if (!this.agentToken) {
      console.error('❌ No agent token found!');
      return;
    }

    const wsUrl = `${this.cloudUrl}?agentId=${this.agentId}&token=${this.agentToken}`;
    console.log(`🔗 Connecting to: ${wsUrl}`);
    console.log(`🔑 Using Agent Token: ${this.agentToken.substring(0, 10)}...`);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('✅ Connected to Backend Server');
      this.isConnected = true;
      this.send({ type: "device_register", agentId: this.agentId, data: this.deviceInfo });
      this.startHeartbeat();

      // === PERIODIC PRINTER STATUS ===
      const sendPeriodic = () => {
        setTimeout(() => {
          if (this.isConnected) {
            console.log("⏱️ Sending periodic printer status...");
            this.sendPrinterStatus();
          }
          sendPeriodic(); // loop forever
        }, 30000);
      };
      sendPeriodic();
    };

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        this.handleCloudMessage(message);
      } catch (error) {
        console.error("Message parse error:", error);
      }
    });

    this.ws.on("close", (code, reason) => {
      console.log(`🔌 Disconnected from Backend: ${code} - ${reason}`);
      this.isConnected = false;
      this.stopHeartbeat();
      this.reconnect();
    });

    this.ws.on("error", (error) => {
      console.error("WebSocket error:", error.message);
      this.isConnected = false;
      this.stopHeartbeat();
    });
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Reconnecting... (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, this.reconnectInterval);
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({
          type: "heartbeat",
          data: { timestamp: new Date().toISOString(), agentId: this.agentId },
        });
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, agentId: this.agentId, timestamp: new Date().toISOString() }));
    } else {
      console.error("Cannot send: WebSocket not connected");
    }
  }

  handleCloudMessage(message) {
    console.log("📨 Received message from backend:", message.type);
    switch (message.type) {
      case "registration_ack":
        console.log(`✅ Registration acknowledged: ${message.message}`);
        setTimeout(() => this.sendPrinterStatus(), 500);
        setTimeout(() => this.sendInkStatus(), 1000);
        break;
      case "ping":
        this.send({ type: "pong" });
        break;
      case "command":
        this.handleCommand(message);
        break;
      default:
        console.log("Received message:", message.type, message);
    }
  }

  async sendPrinterStatus() {
    try {
      const { getPrinters } = await import("../printers/printer.service.js");
      const printers = await getPrinters();
      const printersToSend = printers.map(p => ({ ...p, printerState: p.rawStatus }));
      this.send({ type: "printer_status", data: printersToSend });
      console.log(`✅ Sent printer status (${printers.length} printers)`);
    } catch (error) {
      console.error("❌ Error sending printer status:", error);
      this.sendError(error, "send_printer_status");
    }
  }

  async sendInkStatus() {
    try {
      const { monitorAllPrintersInk } = await import("../ink/ink.service.js");
      const inkStatus = await monitorAllPrintersInk();
      this.send({ type: "ink_status", data: inkStatus });
      console.log(`✅ Sent ink status for ${Object.keys(inkStatus).length} printers`);
    } catch (error) {
      console.error("Error sending ink status:", error);
      this.sendError(error, "send_ink_status");
    }
  }

  handleCommand(message) {
    const { command, data } = message;
    console.log(`Received command: ${command}`, data);
    switch (command) {
      case "pause_printer":
        this.pausePrinter(data.printerName);
        break;
      case "resume_printer":
        this.resumePrinter(data.printerName);
        break;
      case "get_status":
        this.sendPrinterStatus();
        break;
      case "get_ink_status":
        this.sendInkStatus();
        break;
    }
  }

  async pausePrinter(printerName) {
    try {
      const { runPowerShell } = await import("../utils/powershell.js");
      const psScript = `
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='${printerName.replace(/'/g, "''")}'"
if ($printer) {
  $printer.Pause()
  @{status = "PAUSED"; printer = "${printerName}"} | ConvertTo-Json
} else {
  @{status = "NOT_FOUND"; printer = "${printerName}"} | ConvertTo-Json
}
`;
      const result = await runPowerShell(psScript);
      const parsedResult = JSON.parse(result);
      this.send({
        type: "printer_action_result",
        data: { printerName, action: "pause", result: parsedResult.status, timestamp: new Date().toISOString() },
      });
      console.log(`⏸️ Printer ${printerName} paused`);
    } catch (error) {
      console.error(`Error pausing printer ${printerName}:`, error);
      this.sendError(error, `pause_printer_${printerName}`);
    }
  }

  async resumePrinter(printerName) {
    try {
      const { runPowerShell } = await import("../utils/powershell.js");
      const psScript = `
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='${printerName.replace(/'/g, "''")}'"
if ($printer) {
  $printer.Resume()
  @{status = "RESUMED"; printer = "${printerName}"} | ConvertTo-Json
} else {
  @{status = "NOT_FOUND"; printer = "${printerName}"} | ConvertTo-Json
}
`;
      const result = await runPowerShell(psScript);
      const parsedResult = JSON.parse(result);
      this.send({
        type: "printer_action_result",
        data: { printerName, action: "resume", result: parsedResult.status, timestamp: new Date().toISOString() },
      });
      console.log(`▶️ Printer ${printerName} resumed`);
    } catch (error) {
      console.error(`Error resuming printer ${printerName}:`, error);
      this.sendError(error, `resume_printer_${printerName}`);
    }
  }

  sendError(error, context) {
    this.send({ type: "error", data: { message: error.message, stack: error.stack, context, timestamp: new Date().toISOString() } });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.stopHeartbeat();
    this.isConnected = false;
  }
}