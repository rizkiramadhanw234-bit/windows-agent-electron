import WebSocket from "ws";
import fs from "fs/promises";
import path from "path";

const DATA_FILE = "C:/Scripts/printer-dashboard/windows-agent/data/pages.json";

// WebSocket Server
const wss = new WebSocket.Server({ port: 3001 });

console.log("🖨️ WebSocket Print Monitor started on port 3001");

wss.on("connection", (ws) => {
  console.log("🔗 Client connected");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "print_event") {
        console.log(
          `📄 ${data.printer} printed ${data.pages} pages (${data.document})`,
        );

        // Update JSON file
        await updatePageCount(data.printer, data.pages);

        // Broadcast to all clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: "print_update",
                printer: data.printer,
                pages: data.pages,
                total: data.total,
                timestamp: new Date().toISOString(),
              }),
            );
          }
        });
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    console.log("🔌 Client disconnected");
  });
});

async function updatePageCount(printer, pages) {
  try {
    // Read existing data
    let data = {};
    try {
      const content = await fs.readFile(DATA_FILE, "utf8");
      if (content.trim()) {
        data = JSON.parse(content);
      }
    } catch {
      // File doesn't exist or is empty
    }

    const today = new Date().toISOString().split("T")[0];

    // Update data
    if (!data[printer]) {
      data[printer] = {};
    }
    if (!data[printer][today]) {
      data[printer][today] = 0;
    }

    data[printer][today] += pages;

    // Save back
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));

    console.log(`💾 Updated: ${printer} = ${data[printer][today]} pages today`);

    return data[printer][today];
  } catch (error) {
    console.error("Error updating page count:", error);
    throw error;
  }
}

// API endpoint for manual updates
import express from "express";
const app = express();
app.use(express.json());

app.post("/api/print-event", async (req, res) => {
  try {
    const { printer, pages = 1 } = req.body;

    if (!printer) {
      return res.status(400).json({ error: "Printer name required" });
    }

    const total = await updatePageCount(printer, pages);

    // Broadcast via WebSocket
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "print_event",
            printer,
            pages,
            total,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    });

    res.json({
      success: true,
      printer,
      pages,
      total,
      message: `Added ${pages} pages to ${printer}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/today-report", async (req, res) => {
  try {
    const content = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(content || "{}");
    const today = new Date().toISOString().split("T")[0];

    const report = {};
    let totalPages = 0;

    for (const [printer, days] of Object.entries(data)) {
      if (days[today]) {
        report[printer] = days[today];
        totalPages += days[today];
      }
    }

    res.json({
      success: true,
      date: today,
      printers: Object.keys(report).length,
      totalPages,
      data: report,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3002, () => {
  console.log("🌐 HTTP API started on port 3002");
  console.log("📊 GET  http://localhost:3002/api/today-report");
  console.log("📝 POST http://localhost:3002/api/print-event");
});
