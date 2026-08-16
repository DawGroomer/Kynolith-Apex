const { app, BrowserWindow, dialog, session, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { evaluateBridgeHealth } = require("./bridge-health.cjs");
const { checkForUpdate } = require("./update-check.cjs");

let coachServer;
let bridgeProcess;
let bridgeRestartTimer;
let telemetryWatchdog;
let updateCheckTimer;
let lastPromptedUpdateVersion;
let quitting = false;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

async function runUpdateCheck(server) {
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/settings`);

    if (!response.ok) {
      console.warn(`Update setting check failed: ${response.status}`);
      return;
    }

    const settings = await response.json();

    const result = await checkForUpdate({
      enabled: settings.autoCheckUpdates === true,
      currentVersion: app.getVersion()
    });

    if (
      result.status !== "available" ||
      result.version === lastPromptedUpdateVersion
    ) {
      return;
    }

    lastPromptedUpdateVersion = result.version;

    const choice = await dialog.showMessageBox({
      type: "info",
      buttons: ["Open release page", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Kynolith Apex update available",
      message: `Kynolith Apex ${result.version} is available.`,
      detail: `You are running ${app.getVersion()}. Apex will not download or install the update automatically.`
    });

    if (choice.response === 0) {
      await shell.openExternal(result.url);
    }
  }
  catch (error) {
    console.warn(
      "Apex update check unavailable:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function scheduleUpdateChecks(server) {
  if (!app.isPackaged) return;

  clearInterval(updateCheckTimer);

  void runUpdateCheck(server);

  updateCheckTimer = setInterval(
    () => void runUpdateCheck(server),
    UPDATE_CHECK_INTERVAL
  );
}
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
  scheduleUpdateChecks(coachServer);
}

function startTelemetryBridge(server) {
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "Kynolith.LmuBridge.exe")
    : path.join(app.getAppPath(), "bridge", "publish", "Kynolith.LmuBridge.exe");
  let lastFrameAt = 0;
  let disconnectReported = false;
  bridgeProcess = spawn(executable, [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: bridgeProcess.stdout });
  lines.on("line", line => {
    try {
      const frame = JSON.parse(line);
      if (!Number.isFinite(frame.timestamp) || !Number.isFinite(frame.speedKph)) return;
      lastFrameAt = Date.now();
      disconnectReported = false;
      server.ingestTelemetry(frame);
    } catch { /* Ignore partial or diagnostic output; bridge reconnects independently. */ }
  });
  bridgeProcess.stderr.on("data", chunk => process.stderr.write(`[LMU bridge] ${chunk}`));
  telemetryWatchdog = setInterval(() => {
    const health = evaluateBridgeHealth({
      now: Date.now(),
      lastFrameAt,
      disconnectReported
    });

    if (health.disconnect) {
      disconnectReported = true;
      server.disconnectTelemetry().catch(() => {});
    }

    if (health.restart) {
      console.warn("Telemetry bridge stalled; restarting to self-heal.");
      clearInterval(telemetryWatchdog);
      bridgeProcess?.kill();
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
  clearInterval(updateCheckTimer);
  bridgeProcess?.kill();
  coachServer?.close().catch(() => {});
});
