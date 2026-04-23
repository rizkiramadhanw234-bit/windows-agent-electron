import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class InstallerService {
  constructor(options = {}) {
    this.options = {
      appName: "MPS Newton Agent",
      appVersion: "1.2.0",
      installDir: "C:\\Program Files\\PrinterDashboard",
      serviceName: "PrinterMonitorAgent",
      startMenuFolder: "Printer Dashboard",
      ...options,
    };

    this.requiredDependencies = ["node.exe", "powershell.exe"];
  }

  async checkPrerequisites() {
    const results = {
      nodejs: false,
      powershell: false,
      admin: false,
      diskSpace: false,
      requirements: [],
    };

    try {
      const { execSync } = await import("child_process");
      const nodeVersion = execSync("node --version", {
        encoding: "utf8",
      }).trim();
      results.nodejs = true;
      results.nodeVersion = nodeVersion;
    } catch (error) {
      results.requirements.push("Node.js is not installed");
    }

    try {
      const { execSync } = await import("child_process");
      const psVersion = execSync(
        'powershell -Command "$PSVersionTable.PSVersion"',
        {
          encoding: "utf8",
          shell: true,
        },
      ).trim();
      results.powershell = true;
      results.powershellVersion = psVersion;
    } catch (error) {
      results.requirements.push("PowerShell 5.1+ is required");
    }

    if (process.platform === "win32") {
      try {
        const { execSync } = await import("child_process");
        execSync("net session", { stdio: "ignore" });
        results.admin = true;
      } catch (error) {
        results.requirements.push("Administrator privileges required");
      }
    }

    try {
      const freeSpace = await this.checkDiskSpace();
      if (freeSpace > 1024 * 1024 * 100) {
        results.diskSpace = true;
      } else {
        results.requirements.push("Insufficient disk space (100 MB required)");
      }
    } catch (error) {
      // Disk space check failed
    }

    results.allPassed =
      results.nodejs &&
      results.powershell &&
      (process.platform !== "win32" || results.admin) &&
      results.diskSpace;

    return results;
  }

  async checkDiskSpace() {
    if (process.platform === "win32") {
      const { execSync } = await import("child_process");
      const output = execSync(
        'powershell "Get-WmiObject Win32_LogicalDisk -Filter \"DeviceID=\'C:\'\" | Select-Object FreeSpace"',
        {
          encoding: "utf8",
          shell: true,
        },
      );

      const match = output.match(/FreeSpace\s*:\s*(\d+)/);
      if (match) {
        return parseInt(match[1]);
      }
    }

    const stats = await fs.statfs("/");
    return stats.bavail * stats.bsize;
  }

  async createInstallationDirectory() {
    try {
      await fs.mkdir(this.options.installDir, { recursive: true });

      const dirs = ["logs", "data", "config", "scripts", "backups"];

      for (const dir of dirs) {
        await fs.mkdir(path.join(this.options.installDir, dir), {
          recursive: true,
        });
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async copyApplicationFiles() {
    const sourceDir = path.dirname(__dirname);
    const targetDir = this.options.installDir;

    try {
      await fs.copyFile(
        path.join(sourceDir, "package.json"),
        path.join(targetDir, "package.json"),
      );

      await fs.copyFile(
        path.join(sourceDir, "package-lock.json"),
        path.join(targetDir, "package-lock.json"),
      );

      const envExample = path.join(sourceDir, ".env.example");
      const envTarget = path.join(targetDir, ".env");

      if (await this.fileExists(envExample)) {
        await fs.copyFile(envExample, envTarget);
      }

      await this.copyDirectory(
        path.join(sourceDir, "src"),
        path.join(targetDir, "src"),
      );

      await fs.copyFile(
        path.join(sourceDir, "install.bat"),
        path.join(targetDir, "install.bat"),
      );

      await fs.copyFile(
        path.join(sourceDir, "uninstall.bat"),
        path.join(targetDir, "uninstall.bat"),
      );

      return true;
    } catch (error) {
      return false;
    }
  }

  async copyDirectory(source, target) {
    const entries = await fs.readdir(source, { withFileTypes: true });

    await fs.mkdir(target, { recursive: true });

    for (const entry of entries) {
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async installDependencies() {
    return new Promise((resolve, reject) => {
      const npm = spawn("npm", ["install", "--production", "--no-optional"], {
        cwd: this.options.installDir,
        stdio: "inherit",
        shell: true,
      });

      npm.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error(`npm install failed with code ${code}`));
        }
      });

      npm.on("error", (error) => {
        reject(error);
      });
    });
  }

  async createWindowsService() {
    if (process.platform !== "win32") {
      return true;
    }

    return new Promise(async (resolve, reject) => {
      try {
        const { installWindowsService } = await import("./windows.service.js");

        await installWindowsService({
          name: this.options.serviceName,
          description: `${this.options.appName} v${this.options.appVersion}`,
          script: path.join(this.options.installDir, "src", "index.js"),
          workingDirectory: this.options.installDir,
          env: [
            {
              name: "NODE_ENV",
              value: "production",
            },
            {
              name: "INSTALL_DIR",
              value: this.options.installDir,
            },
          ],
        });

        resolve(true);
      } catch (error) {
        reject(error);
      }
    });
  }

  async createStartMenuShortcuts() {
    if (process.platform !== "win32") {
      return true;
    }

    try {
      const startMenuPath = path.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        this.options.startMenuFolder,
      );

      await fs.mkdir(startMenuPath, { recursive: true });

      const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$startMenu = [System.IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'), 'Programs', '${this.options.startMenuFolder}')

$agentShortcut = $WshShell.CreateShortcut("$startMenu\\${this.options.appName}.lnk")
$agentShortcut.TargetPath = "node.exe"
$agentShortcut.Arguments = "${path.join(this.options.installDir, "src", "index.js")}"
$agentShortcut.WorkingDirectory = "${this.options.installDir}"
$agentShortcut.Description = "${this.options.appName}"
$agentShortcut.Save()

$dashboardShortcut = $WshShell.CreateShortcut("$startMenu\\Printer Dashboard.lnk")
$dashboardShortcut.TargetPath = "http://localhost:5000"
$dashboardShortcut.Description = "Open Printer Dashboard"
$dashboardShortcut.Save()

$uninstallShortcut = $WshShell.CreateShortcut("$startMenu\\Uninstall.lnk")
$uninstallShortcut.TargetPath = "${path.join(this.options.installDir, "uninstall.bat")}"
$uninstallShortcut.WorkingDirectory = "${this.options.installDir}"
$uninstallShortcut.Description = "Uninstall ${this.options.appName}"
$uninstallShortcut.Save()
`;

      const { runPowerShell } = await import("../utils/powershell.js");
      await runPowerShell(psScript);

      return true;
    } catch (error) {
      return false;
    }
  }

  async createFirewallRules() {
    if (process.platform !== "win32") {
      return true;
    }

    try {
      const psScript = `
New-NetFirewallRule -DisplayName "Printer Dashboard HTTP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Printer Dashboard WebSocket" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Printer Dashboard Outbound" -Direction Outbound -Action Allow -Program "${process.execPath}" -ErrorAction SilentlyContinue
`;

      const { runPowerShell } = await import("../utils/powershell.js");
      await runPowerShell(psScript);

      return true;
    } catch (error) {
      return false;
    }
  }

  async generateConfiguration() {
    try {
      const configPath = path.join(
        this.options.installDir,
        "config",
        "agent.json",
      );
      const hostname = os.hostname();
      const username = os.userInfo().username;

      const config = {
        agent: {
          id: this.generateAgentId(hostname, username),
          name: hostname,
          location: this.checkLocation,
          installedAt: new Date().toISOString(),
          version: this.options.appVersion,
        },
        installation: {
          directory: this.options.installDir,
          serviceName: this.options.serviceName,
          windowsService: true,
        },
        settings: {
          httpPort: 5000,
          wsPort: 3001,
          cloudEnabled: false,
          autoUpdate: true,
        },
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const envPath = path.join(this.options.installDir, ".env");
      let envContent = "";

      if (await this.fileExists(envPath)) {
        envContent = await fs.readFile(envPath, "utf8");
        envContent = envContent.replace(
          /AGENT_ID=.*/g,
          `AGENT_ID=${config.agent.id}`,
        );
        await fs.writeFile(envPath, envContent);
      }

      return config.agent.id;
    } catch (error) {
      return null;
    }
  }

  generateAgentId(hostname, username) {
    const crypto = require("crypto");
    return crypto
      .createHash("md5")
      .update(hostname + username + Date.now())
      .digest("hex")
      .substring(0, 12)
      .toUpperCase();
  }

  async createUninstaller() {
    try {
      const uninstallerPath = path.join(
        this.options.installDir,
        "uninstall.bat",
      );
      const uninstallerContent = `
@echo off
echo ========================================
echo Printer Dashboard Uninstaller
echo ========================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Please run as Administrator!
    pause
    exit /b 1
)

echo Stopping service...
net stop "${this.options.serviceName}" 2>nul
timeout /t 3 /nobreak >nul

echo.
echo Removing service...
sc delete "${this.options.serviceName}" 2>nul

echo.
echo Removing firewall rules...
netsh advfirewall firewall delete rule name="Printer Dashboard HTTP" 2>nul
netsh advfirewall firewall delete rule name="Printer Dashboard WebSocket" 2>nul
netsh advfirewall firewall delete rule name="Printer Dashboard Outbound" 2>nul

echo.
echo Removing Start Menu shortcuts...
powershell -Command "Remove-Item '~\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\${this.options.startMenuFolder}' -Recurse -Force -ErrorAction SilentlyContinue"

echo.
echo Removing installation directory...
rd /s /q "${this.options.installDir}" 2>nul

echo.
echo ========================================
echo UNINSTALL COMPLETE!
echo Printer Dashboard has been removed.
echo ========================================
echo.
pause
`;

      await fs.writeFile(uninstallerPath, uninstallerContent);
      return true;
    } catch (error) {
      return false;
    }
  }

  async performInstall() {
    const prerequisites = await this.checkPrerequisites();
    if (!prerequisites.allPassed) {
      return { success: false, error: "Prerequisites not met" };
    }

    try {
      if (!(await this.createInstallationDirectory())) {
        return {
          success: false,
          error: "Failed to create installation directory",
        };
      }

      if (!(await this.copyApplicationFiles())) {
        return { success: false, error: "Failed to copy application files" };
      }

      await this.installDependencies();

      const agentId = await this.generateConfiguration();

      if (process.platform === "win32") {
        await this.createWindowsService();
      }

      if (process.platform === "win32") {
        await this.createStartMenuShortcuts();
      }

      if (process.platform === "win32") {
        await this.createFirewallRules();
      }

      await this.createUninstaller();

      return {
        success: true,
        agentId,
        installDir: this.options.installDir,
        serviceName: this.options.serviceName,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export const installer = new InstallerService();