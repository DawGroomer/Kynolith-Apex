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
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

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
  startTelemetryBridge(coachServer);

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

function startTelemetryBridge(server) {
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "Kynolith.LmuBridge.exe")
    : path.join(app.getAppPath(), "bridge", "publish", "Kynolith.LmuBridge.exe");
  let lastFrameAt = 0;
  bridgeProcess = spawn(executable, [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: bridgeProcess.stdout });
  lines.on("line", line => {
    try {
      const frame = JSON.parse(line);
      if (!Number.isFinite(frame.timestamp) || !Number.isFinite(frame.speedKph)) return;
      lastFrameAt = Date.now();
      server.ingestTelemetry(frame);
    } catch { /* Ignore partial or diagnostic output; bridge reconnects independently. */ }
  });
  bridgeProcess.stderr.on("data", chunk => process.stderr.write(`[LMU bridge] ${chunk}`));
  telemetryWatchdog = setInterval(() => {
    if (lastFrameAt && Date.now() - lastFrameAt > 2500) {
      lastFrameAt = 0;
      server.disconnectTelemetry().catch(() => {});
    }
  }, 1000);
  bridgeProcess.on("exit", () => {
    clearInterval(telemetryWatchdog);
    server.disconnectTelemetry().catch(() => {});
    if (!quitting) bridgeRestartTimer = setTimeout(() => startTelemetryBridge(server), 2000);
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
