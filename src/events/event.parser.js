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

      for (const [key, pattern] of Object.entries(this.patterns)) {
        if (pattern.id === eventId) {
          const match = message.match(pattern.regex);
          if (match) {
            const baseData = pattern.extract(match);

            return {
              ...baseData,
              eventId,
              recordId,
              timestamp: timestamp
                ? new Date(timestamp).toISOString()
                : new Date().toISOString(),
              rawMessage: message.substring(0, 500),
              agentTime: new Date().toISOString(),
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
