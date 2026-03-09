export class EventParser {
  constructor() {
    this.patterns = {
      printJob: {
        id: 307,
        regex: /printed on\s+(.+?)\s+through.*?Pages printed:\s*(\d+)/is,
        extract: (match) => ({
          event: "print_job_completed",
          printer: match[1].trim(),
          pages: parseInt(match[2]) || 1,
        }),
      },
      // ADD THIS - For WSD printers like Canon MF642C
      printJobWSD: {
        id: 307,
        regex: /Document\s+\d+,\s+(.+?)\s+owned by.*?Pages printed:\s*(\d+)/is,
        extract: (match) => ({
          event: "print_job_completed_wsd",
          printer: match[1].trim(),
          pages: parseInt(match[2]) || 1,
        }),
      },
      // ADD THIS - Event ID 10 often has page count
      printJobRendered: {
        id: 10,
        regex: /Total pages:\s*(\d+).*?Document:\s*(.+?)(\r|\n|\.)/is,
        extract: (match) => ({
          event: "print_job_rendered",
          printer: "Unknown", // Will need to be filled from context
          pages: parseInt(match[1]) || 1,
          document: match[2]?.trim(),
        }),
      },
      // ADD THIS - Generic print completion
      printJobGeneric: {
        id: 307,
        regex: /(?:printer|printer name):\s*(.+?)(?:\r|\n|\.).*?(\d+)\s+pages?/is,
        extract: (match) => ({
          event: "print_job_generic",
          printer: match[1].trim(),
          pages: parseInt(match[2]) || 1,
        }),
      },
      printerError: {
        id: 263,
        regex: /Printer\s+(.+?)\s+Driver\s+(.+?)\s+encountered an error/i,
        extract: (match) => ({
          event: "printer_error",
          printer: match[1].trim(),
          driver: match[2].trim(),
          severity: "error",
        }),
      },
      printerOffline: {
        id: 411,
        regex: /Printer\s+(.+?)\s+is now offline/i,
        extract: (match) => ({
          event: "printer_offline",
          printer: match[1].trim(),
          severity: "warning",
        }),
      },
    };
  }

  parseEvent(event) {
    try {
      const {
        Id: eventId,
        Message: message,
        TimeCreated: timestamp,
        RecordId: recordId,
      } = event;

      if (!message) return null;

      // Try all patterns that match this event ID
      for (const [key, pattern] of Object.entries(this.patterns)) {
        if (pattern.id === eventId || pattern.id === eventId) {
          const match = message.match(pattern.regex);
          if (match) {
            const baseData = pattern.extract(match);

            // Special handling for Canon/WSD printers
            const isCanonWSD = message.match(/(MF642C|MF643C|MF644C|Canon)/i) ||
              (baseData.printer && baseData.printer.match(/(MF642C|MF643C|MF644C|Canon)/i));

            return {
              ...baseData,
              eventId,
              recordId,
              timestamp: timestamp
                ? new Date(timestamp).toISOString()
                : new Date().toISOString(),
              rawMessage: message.substring(0, 500),
              agentTime: new Date().toISOString(),
              printerType: isCanonWSD ? "wsd" : "standard",
              detectionMethod: key,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Event parsing error:", error);
      return null;
    }
  }

  parseEvents(events) {
    if (!Array.isArray(events)) {
      events = [events];
    }

    const parsedEvents = [];
    let lastRecordId = 0;

    for (const event of events) {
      const parsed = this.parseEvent(event);
      if (parsed) {
        parsedEvents.push(parsed);
        if (parsed.recordId > lastRecordId) {
          lastRecordId = parsed.recordId;
        }
      }
    }

    return {
      events: parsedEvents,
      lastRecordId,
      count: parsedEvents.length,
      timestamp: new Date().toISOString(),
    };
  }
}

export default new EventParser();