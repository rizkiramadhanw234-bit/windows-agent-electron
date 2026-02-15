import { addPages } from "../pages/page.store.backup.js";

let printerErrors = {};

export async function getPrinterErrors(printer) {
  return printerErrors[printer] || [];
}

export async function processPrintEvents(events) {
  for (const e of events) {
    if (!e.printer || !e.pages) continue;

    await addPages(e.printer, Number(e.pages));

    if (e.error) {
      if (!printerErrors[e.printer]) {
        printerErrors[e.printer] = [];
      }
      printerErrors[e.printer].push(e.error);
    }
  }
}
