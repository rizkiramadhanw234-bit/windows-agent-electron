import { getInkStatus } from '../ink/ink.service.js';
import { runPowerShell } from '../utils/powershell.js';

export class AutoPauseManager {
  constructor(config = {}) {
    this.config = {
      pauseOnLowInk: true,
      lowInkThreshold: 15,
      pauseOnError: true,
      ...config
    };
    
    this.pausedPrinters = new Set();
  }

  async checkAndPause(printerName) {
    try {
      const inkStatus = await getInkStatus(printerName);
      
      if (this.config.pauseOnLowInk && inkStatus.levels) {
        const lowInkColors = Object.entries(inkStatus.levels)
          .filter(([_, level]) => level !== null && level < this.config.lowInkThreshold)
          .map(([color]) => color);
        
        if (lowInkColors.length > 0) {
          await this.pausePrinter(printerName, `Low ink: ${lowInkColors.join(', ')}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`Auto-pause check failed for ${printerName}:`, error);
      return false;
    }
  }

  async pausePrinter(printerName, reason = 'Auto-paused') {
    const psScript = `
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='$($printerName.Replace("'", "''"))'"
if ($printer) {
  $printer.Pause()
  "PAUSED"
} else {
  "NOT_FOUND"
}
`;
    
    await runPowerShell(psScript);
    this.pausedPrinters.add(printerName);
    
    console.log(`⏸️ ${printerName} paused: ${reason}`);
    
    return true;
  }

  async resumePrinter(printerName) {
    const psScript = `
$printer = Get-WmiObject -Class Win32_Printer -Filter "Name='$($printerName.Replace("'", "''"))'"
if ($printer) {
  $printer.Resume()
  "RESUMED"
} else {
  "NOT_FOUND"
}
`;
    
    await runPowerShell(psScript);
    this.pausedPrinters.delete(printerName);
    
    console.log(`▶️ ${printerName} resumed`);
    
    return true;
  }

  isPaused(printerName) {
    return this.pausedPrinters.has(printerName);
  }
}