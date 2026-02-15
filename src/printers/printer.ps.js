import { runPowerShell } from "../utils/powershell.js";

export async function fetchPrintersRaw() {
  const ps = `
Get-WmiObject -Class Win32_Printer |
Select-Object Name, PrinterStatus, Shared, WorkOffline, PortName, DriverName, Location, Comment, 
               @{Name="Status";Expression={
                 switch($_.PrinterStatus) {
                   1 {"Other"}
                   2 {"Unknown"} 
                   3 {"Idle"}
                   4 {"Printing"}
                   5 {"Warmup"}
                   6 {"Stopped"}
                   7 {"Offline"}
                   default {"Unknown"}
                 }
               }} |
ConvertTo-Json
`;
  
  try {
    const out = await runPowerShell(ps);
    // console.log("📄 Raw WMI output:", out.substring(0, 500));
    
    const parsed = JSON.parse(out);
    console.log(`✅ Parsed ${Array.isArray(parsed) ? parsed.length : 1} printers`);
    
    return parsed;
  } catch (error) {
    console.error("❌ Failed to fetch printers:", error.message);
    
    // Fallback: try alternative query
    return await fetchPrintersAlternative();
  }
}

async function fetchPrintersAlternative() {
  const ps = `
try {
    $printers = Get-Printer -ErrorAction Stop
    $result = @()
    
    foreach ($p in $printers) {
        $printerStatus = 3  # Default to Idle
        
        if ($p.PrinterStatus -eq "Normal") { $printerStatus = 3 }
        elseif ($p.PrinterStatus -eq "Printing") { $printerStatus = 4 }
        elseif ($p.PrinterStatus -eq "Error") { $printerStatus = 7 }
        elseif ($p.PrinterStatus -eq "Offline") { $printerStatus = 7 }
        elseif ($p.PrinterStatus -eq "Paused") { $printerStatus = 6 }
        
        $result += [PSCustomObject]@{
            Name = $p.Name
            PrinterStatus = $printerStatus
            Shared = $p.Shared
            WorkOffline = $false
            PortName = $p.PortName
            DriverName = $p.DriverName
            Location = $p.Location
            Comment = $p.Comment
            Status = $p.PrinterStatus
        }
    }
    
    $result | ConvertTo-Json
}
catch {
    "[]"
}
`;
  
  try {
    const out = await runPowerShell(ps);
    return JSON.parse(out);
  } catch {
    return [];
  }
}