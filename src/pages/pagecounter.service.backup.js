import { runPowerShell } from "../utils/powershell.js";
import { addPages } from "./page.store.js";

export async function collectPageCount() {
  const script = `
$events = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -FilterXPath "*[System/EventID=307]" -MaxEvents 20 -ErrorAction SilentlyContinue;
$events | ForEach-Object {
  $msg = $_.Message;
  $printer = $null;
  $pages = $null;

  if ($msg -match "Printer Name:\\s+(.*)") { $printer = $matches[1] }
  if ($msg -match "Pages Printed:\\s+(\\d+)") { $pages = [int]$matches[1] }

  if ($printer -and $pages) {
    [PSCustomObject]@{ Printer = $printer; Pages = $pages }
  }
} | ConvertTo-Json -Compress
  `.trim();

  const output = await runPowerShell(script);
  if (!output || output.trim() === "") return;

  let records;
  try {
    records = JSON.parse(output);
  } catch {
    console.warn("PAGE PARSE SKIPPED:", output);
    return;
  }

  const list = Array.isArray(records) ? records : [records];

  for (const r of list) {
    await addPages(r.Printer, r.Pages);
  }
}
