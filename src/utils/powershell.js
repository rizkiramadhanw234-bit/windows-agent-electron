import { spawn } from "child_process";

const POOL_SIZE = 2;
const MAX_QUEUE = 50;
const IDLE_TIMEOUT = 30000;
const DEFAULT_TIMEOUT = 10000;

const workers = [];
const queue = [];

function spawnWorker() {
  const ps = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-Command", "-"
  ], { windowsHide: true });

  const worker = { process: ps, busy: false, idleTimer: null, pending: null };

  ps.on("error", () => removeWorker(worker));
  ps.on("close", () => removeWorker(worker));

  workers.push(worker);
  return worker;
}

function removeWorker(worker) {
  const idx = workers.indexOf(worker);
  if (idx !== -1) workers.splice(idx, 1);

  if (worker.pending) {
    worker.pending.reject(new Error("PowerShell worker died"));
    worker.pending = null;
  }

  drainQueue();
}

function resetIdleTimer(worker) {
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleTimer = setTimeout(() => {
    if (!worker.busy) {
      try { worker.process.kill(); } catch (_) { }
    }
  }, IDLE_TIMEOUT);
}

function runOnWorker(worker, script, timeout, resolve, reject) {
  worker.busy = true;
  if (worker.idleTimer) clearTimeout(worker.idleTimer);

  let stdout = "";
  let stderr = "";
  let settled = false;
  let killed = false;

  const sentinel = `__DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    killed = true;
    try { worker.process.kill(); } catch (_) { }
    finishWorker(worker);
    reject(new Error("PowerShell timeout"));
  }, timeout);

  function onData(chunk) {
    stdout += chunk.toString();
    if (stdout.includes(sentinel)) {
      stdout = stdout.slice(0, stdout.indexOf(sentinel)).trimEnd();
      done();
    }
  }

  function onErr(chunk) {
    stderr += chunk.toString();
  }

  function done() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();

    if (
      stderr.includes("UnauthorizedAccess") ||
      stderr.includes("Execution_Policies")
    ) {
      finishWorker(worker);
      return reject(new Error(
        `PowerShell Execution Policy Error: ${stderr}. ` +
        `Run as Administrator: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force`
      ));
    }

    finishWorker(worker);
    resolve(stdout.trim());
  }

  function cleanup() {
    worker.process.stdout.off("data", onData);
    worker.process.stderr.off("data", onErr);
  }

  worker.pending = { resolve, reject };
  worker.process.stdout.on("data", onData);
  worker.process.stderr.on("data", onErr);

  worker.process.stdin.write(
    `${script}\nWrite-Host '${sentinel}'\n`,
    "utf8"
  );
}

function finishWorker(worker) {
  worker.busy = false;
  worker.pending = null;

  if (!worker.process.killed) {
    resetIdleTimer(worker);
    drainQueue();
  }
}

function drainQueue() {
  if (queue.length === 0) return;

  let worker = workers.find(w => !w.busy && !w.process.killed);

  if (!worker && workers.length < POOL_SIZE) {
    worker = spawnWorker();
  }

  if (!worker) return;

  const task = queue.shift();
  runOnWorker(worker, task.script, task.timeout, task.resolve, task.reject);
}

export function runPowerShell(script, { timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    if (queue.length >= MAX_QUEUE) {
      return reject(new Error("PowerShell queue full — terlalu banyak request bersamaan"));
    }

    queue.push({ script, timeout, resolve, reject });
    drainQueue();
  });
}