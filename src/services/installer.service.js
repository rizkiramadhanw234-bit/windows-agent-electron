import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class InstallerService {
  constructor(options = {}) {
    this.options = {
      appName: "Printer Dashboard Agent",
      appVersion: "1.2.0",
      installDir: "C:\\Program Files\\PrinterDashboard",
      serviceName: "PrinterMonitorAgent",
      startMenuFolder: "Printer Dashboard",
      ...options,
    };

    this.requiredDependencies = ["node.exe", "powershell.exe"];
  }

  async checkPrerequisites() {
    console.log("🔍 Checking prerequisites...");

    const results = {
      nodejs: false,
      powershell: false,
      admin: false,
      diskSpace: false,
      requirements: [],
    };

    // Check Node.js
    try {
      const { execSync } = await import("child_process");
      const nodeVersion = execSync("node --version", {
        encoding: "utf8",
      }).trim();
      results.nodejs = true;
      results.nodeVersion = nodeVersion;
      console.log(`✅ Node.js: ${nodeVersion}`);
    } catch (error) {
      results.requirements.push("Node.js is not installed");
      console.log("❌ Node.js: Not found");
    }

    // Check PowerShell
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
      console.log(`✅ PowerShell: ${psVersion}`);
    } catch (error) {
      results.requirements.push("PowerShell 5.1+ is required");
      console.log("❌ PowerShell: Not found or version too old");
    }

    // Check admin rights (Windows only)
    if (process.platform === "win32") {
      try {
        const { execSync } = await import("child_process");
        execSync("net session", { stdio: "ignore" });
        results.admin = true;
        console.log("✅ Admin privileges: Granted");
      } catch (error) {
        results.requirements.push("Administrator privileges required");
        console.log("❌ Admin privileges: Not running as administrator");
      }
    }

    // Check disk space
    try {
      const freeSpace = await this.checkDiskSpace();
      if (freeSpace > 1024 * 1024 * 100) {
        // 100 MB minimum
        results.diskSpace = true;
        console.log(
          `✅ Disk space: ${Math.round(freeSpace / (1024 * 1024))} MB available`,
        );
      } else {
        results.requirements.push("Insufficient disk space (100 MB required)");
        console.log(
          `❌ Disk space: Only ${Math.round(freeSpace / (1024 * 1024))} MB available`,
        );
      }
    } catch (error) {
      console.log("⚠️ Disk space: Could not check");
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

    // Fallback for other platforms
    const stats = await fs.statfs("/");
    return stats.bavail * stats.bsize;
  }

  async createInstallationDirectory() {
    console.log(
      `📁 Creating installation directory: ${this.options.installDir}`,
    );

    try {
      await fs.mkdir(this.options.installDir, { recursive: true });

      // Create subdirectories
      const dirs = ["logs", "data", "config", "scripts", "backups"];

      for (const dir of dirs) {
        await fs.mkdir(path.join(this.options.installDir, dir), {
          recursive: true,
        });
      }

      console.log("✅ Installation directory created");
      return true;
    } catch (error) {
      console.error(
        "❌ Failed to create installation directory:",
        error.message,
      );
      return false;
    }
  }

  async copyApplicationFiles() {
    console.log("📂 Copying application files...");

    const sourceDir = path.dirname(__dirname); // Backend directory
    const targetDir = this.options.installDir;

    try {
      // Copy package.json and lock file
      await fs.copyFile(
        path.join(sourceDir, "package.json"),
        path.join(targetDir, "package.json"),
      );

      await fs.copyFile(
        path.join(sourceDir, "package-lock.json"),
        path.join(targetDir, "package-lock.json"),
      );

      // Copy .env.example as .env
      const envExample = path.join(sourceDir, ".env.example");
      const envTarget = path.join(targetDir, ".env");

      if (await this.fileExists(envExample)) {
        await fs.copyFile(envExample, envTarget);
        console.log("✅ Configuration file created");
      }

      // Copy src directory
      await this.copyDirectory(
        path.join(sourceDir, "src"),
        path.join(targetDir, "src"),
      );

      // Copy install scripts
      await fs.copyFile(
        path.join(sourceDir, "install.bat"),
        path.join(targetDir, "install.bat"),
      );

      await fs.copyFile(
        path.join(sourceDir, "uninstall.bat"),
        path.join(targetDir, "uninstall.bat"),
      );

      console.log("✅ Application files copied");
      return true;
    } catch (error) {
      console.error("❌ Failed to copy application files:", error.message);
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
    console.log("📦 Installing Node.js dependencies...");

    return new Promise((resolve, reject) => {
      const npm = spawn("npm", ["install", "--production", "--no-optional"], {
        cwd: this.options.installDir,
        stdio: "inherit",
        shell: true,
      });

      npm.on("close", (code) => {
        if (code === 0) {
          console.log("✅ Dependencies installed");
          resolve(true);
        } else {
          console.error("❌ Failed to install dependencies");
          reject(new Error(`npm install failed with code ${code}`));
        }
      });

      npm.on("error", (error) => {
        console.error("❌ Failed to run npm:", error.message);
        reject(error);
      });
    });
  }

  async createWindowsService() {
    if (process.platform !== "win32") {
      console.log("⚠️ Windows service creation skipped (not Windows)");
      return true;
    }

    console.log("🛠️ Creating Windows service...");

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

        console.log("✅ Windows service created");
        resolve(true);
      } catch (error) {
        console.error("❌ Failed to create Windows service:", error.message);
        reject(error);
      }
    });
  }

  async createStartMenuShortcuts() {
    if (process.platform !== "win32") {
      return true;
    }

    console.log("📋 Creating Start Menu shortcuts...");

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

      // Create shortcuts using PowerShell
      const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$startMenu = [System.IO.Path]::Combine([Environment]::GetFolderPath('StartMenu'), 'Programs', '${this.options.startMenuFolder}')

# Agent shortcut
$agentShortcut = $WshShell.CreateShortcut("$startMenu\\${this.options.appName}.lnk")
$agentShortcut.TargetPath = "node.exe"
$agentShortcut.Arguments = "${path.join(this.options.installDir, "src", "index.js")}"
$agentShortcut.WorkingDirectory = "${this.options.installDir}"
$agentShortcut.Description = "${this.options.appName}"
$agentShortcut.Save()

# Dashboard shortcut (if web interface exists)
$dashboardShortcut = $WshShell.CreateShortcut("$startMenu\\Printer Dashboard.lnk")
$dashboardShortcut.TargetPath = "http://localhost:5000"
$dashboardShortcut.Description = "Open Printer Dashboard"
$dashboardShortcut.Save()

# Uninstall shortcut
$uninstallShortcut = $WshShell.CreateShortcut("$startMenu\\Uninstall.lnk")
$uninstallShortcut.TargetPath = "${path.join(this.options.installDir, "uninstall.bat")}"
$uninstallShortcut.WorkingDirectory = "${this.options.installDir}"
$uninstallShortcut.Description = "Uninstall ${this.options.appName}"
$uninstallShortcut.Save()
`;

      const { runPowerShell } = await import("../utils/powershell.js");
      await runPowerShell(psScript);

      console.log("✅ Start Menu shortcuts created");
      return true;
    } catch (error) {
      console.error("❌ Failed to create shortcuts:", error.message);
      return false;
    }
  }

  async createFirewallRules() {
    if (process.platform !== "win32") {
      return true;
    }

    console.log("🔥 Creating firewall rules...");

    try {
      const psScript = `
# Allow HTTP port (5000)
New-NetFirewallRule -DisplayName "Printer Dashboard HTTP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -ErrorAction SilentlyContinue

# Allow WebSocket port (3001)
New-NetFirewallRule -DisplayName "Printer Dashboard WebSocket" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -ErrorAction SilentlyContinue

# Allow outbound connections (for cloud sync)
New-NetFirewallRule -DisplayName "Printer Dashboard Outbound" -Direction Outbound -Action Allow -Program "${process.execPath}" -ErrorAction SilentlyContinue
`;

      const { runPowerShell } = await import("../utils/powershell.js");
      await runPowerShell(psScript);

      console.log("✅ Firewall rules created");
      return true;
    } catch (error) {
      console.error("⚠️ Firewall rules may not be configured:", error.message);
      return false;
    }
  }

  async generateConfiguration() {
    console.log("⚙️ Generating configuration...");

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
      console.log("✅ Configuration generated");

      // Update .env file with agent ID
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
      console.error("❌ Failed to generate configuration:", error.message);
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
    console.log("🗑️ Creating uninstaller...");

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

REM Check for admin rights
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
      console.log("✅ Uninstaller created");
      return true;
    } catch (error) {
      console.error("❌ Failed to create uninstaller:", error.message);
      return false;
    }
  }

  async performInstall() {
    console.log("\n" + "=".repeat(60));
    console.log(`${this.options.appName} Installer`);
    console.log("=".repeat(60));

    // Check prerequisites
    const prerequisites = await this.checkPrerequisites();
    if (!prerequisites.allPassed) {
      console.log("\n❌ Prerequisites check failed:");
      prerequisites.requirements.forEach((req) => console.log(`   - ${req}`));
      console.log("\nPlease fix the issues and try again.");
      return { success: false, error: "Prerequisites not met" };
    }

    try {
      // Step 1: Create directory
      if (!(await this.createInstallationDirectory())) {
        return {
          success: false,
          error: "Failed to create installation directory",
        };
      }

      // Step 2: Copy files
      if (!(await this.copyApplicationFiles())) {
        return { success: false, error: "Failed to copy application files" };
      }

      // Step 3: Install dependencies
      await this.installDependencies();

      // Step 4: Generate configuration
      const agentId = await this.generateConfiguration();

      // Step 5: Create Windows service
      if (process.platform === "win32") {
        await this.createWindowsService();
      }

      // Step 6: Create Start Menu shortcuts (Windows)
      if (process.platform === "win32") {
        await this.createStartMenuShortcuts();
      }

      // Step 7: Create firewall rules (Windows)
      if (process.platform === "win32") {
        await this.createFirewallRules();
      }

      // Step 8: Create uninstaller
      await this.createUninstaller();

      console.log("\n" + "=".repeat(60));
      console.log("✅ INSTALLATION COMPLETE!");
      console.log("=".repeat(60));
      console.log(`\nInstallation directory: ${this.options.installDir}`);
      console.log(`Agent ID: ${agentId}`);
      console.log(`HTTP Dashboard: http://localhost:5000`);
      console.log(`WebSocket: ws://localhost:3001`);

      if (process.platform === "win32") {
        console.log(`\nService Name: ${this.options.serviceName}`);
        console.log("Start Menu: Printer Dashboard");
        console.log("\nThe service will start automatically on system boot.");
      }

      console.log("\nNext steps:");
      console.log("1. Edit the .env file for cloud configuration");
      console.log("2. Restart the service to apply changes");
      console.log("3. Open the dashboard to verify installation");
      console.log("=".repeat(60));

      return {
        success: true,
        agentId,
        installDir: this.options.installDir,
        serviceName: this.options.serviceName,
      };
    } catch (error) {
      console.error("\n❌ Installation failed:", error.message);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const installer = new InstallerService();
