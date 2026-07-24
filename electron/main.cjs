const { app, BrowserWindow, dialog, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

let coachServer;
let bridgeProcess;
let bridgeRestartTimer;
let telemetryWatchdog;
let quitting = false;

async function createWindow() {
  process.env.KYNOLITH_DESKTOP = "1";
  const appRoot = app.getAppPath();
  const serverModuleUrl = pathToFileURL(path.join(appRoot, "dist", "server.js")).href;
  const { startCoachServer } = await import(serverModuleUrl);
  const userData = app.getPath("userData");
  coachServer = await startCoachServer({
    port: 0,
    publicDir: path.join(appRoot, "public"),
    dataDir: userData,
    bundledModelsDir: app.isPackaged
      ? path.join(process.resourcesPath, "models")
      : path.join(appRoot, "offline-models")
  });
  startTelemetryBridge(coachServer.port);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "media");

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#060a0c",
    autoHideMenuBar: true,
    title: "Kynolith Apex // LMU Coach",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  await win.loadURL(`http://127.0.0.1:${coachServer.port}`);
}

function startTelemetryBridge(port) {
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "Kynolith.LmuBridge.exe")
    : path.join(app.getAppPath(), "bridge", "publish", "Kynolith.LmuBridge.exe");
  let lastFrameAt = 0;
  bridgeProcess = spawn(executable, [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: bridgeProcess.stdout });
  lines.on("line", async line => {
    try {
      const frame = JSON.parse(line);
      if (!Number.isFinite(frame.timestamp) || !Number.isFinite(frame.speedKph)) return;
      lastFrameAt = Date.now();
      await fetch(`http://127.0.0.1:${port}/api/telemetry`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(frame)
      });
    } catch { /* Ignore partial or diagnostic output; bridge reconnects independently. */ }
  });
  bridgeProcess.stderr.on("data", chunk => process.stderr.write(`[LMU bridge] ${chunk}`));
  telemetryWatchdog = setInterval(() => {
    if (lastFrameAt && Date.now() - lastFrameAt > 2500) {
      lastFrameAt = 0;
      fetch(`http://127.0.0.1:${port}/api/telemetry/disconnect`, { method: "POST" }).catch(() => {});
    }
  }, 1000);
  bridgeProcess.on("exit", () => {
    clearInterval(telemetryWatchdog);
    fetch(`http://127.0.0.1:${port}/api/telemetry/disconnect`, { method: "POST" }).catch(() => {});
    if (!quitting) bridgeRestartTimer = setTimeout(() => startTelemetryBridge(port), 2000);
  });
}

app.whenReady().then(createWindow).catch(error => {
  dialog.showErrorBox("Kynolith Apex failed to start", error?.stack || String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  clearTimeout(bridgeRestartTimer);
  clearInterval(telemetryWatchdog);
  bridgeProcess?.kill();
  coachServer?.close().catch(() => {});
});
