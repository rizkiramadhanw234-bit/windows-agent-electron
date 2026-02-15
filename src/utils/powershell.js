import { spawn } from "child_process";

export function runPowerShell(script, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    // Always add ExecutionPolicy Bypass
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ];

    const ps = spawn("powershell.exe", args, {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      ps.kill("SIGKILL");
      reject(new Error("PowerShell timeout"));
    }, timeout);

    ps.stdout.on("data", (d) => (stdout += d.toString()));
    ps.stderr.on("data", (d) => (stderr += d.toString()));

    ps.on("close", (code) => {
      clearTimeout(timer);

      if (killed) return;

      // Output error jika ada
      if (
        (stderr && stderr.includes("UnauthorizedAccess")) ||
        stderr.includes("Execution_Policies")
      ) {
        const errorMsg = `PowerShell Execution Policy Error: ${stderr}. Run as Administrator and execute: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force`;
        return reject(new Error(errorMsg));
      }

      if (code !== 0) {
        return reject(new Error(stderr || `PS exited with code ${code}`));
      }

      resolve(stdout.trim());
    });

    ps.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
