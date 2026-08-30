const { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, screen, session, shell } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { evaluateBridgeHealth } = require("./bridge-health.cjs");
const { writeBridgeDiagnostic } = require("./bridge-diagnostics.cjs");
const { checkForUpdate } = require("./update-check.cjs");

let coachServer;
let mainWindow;
let hudWindow;
let hudServerPort;
let hudBoundsPath;
let hudBoundsSaveTimer;
let hudLocked = false;
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

function isValidHudBounds(value) {
  return (
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width >= 640 &&
    value.height >= 360
  );
}

function clampHudBounds(bounds, displayBounds) {
  const width = Math.min(
    Math.max(640, Math.round(bounds.width)),
    displayBounds.width
  );
  const height = Math.min(
    Math.max(360, Math.round(bounds.height)),
    displayBounds.height
  );

  return {
    width,
    height,
    x: Math.max(
      displayBounds.x,
      Math.min(bounds.x, displayBounds.x + displayBounds.width - width)
    ),
    y: Math.max(
      displayBounds.y,
      Math.min(bounds.y, displayBounds.y + displayBounds.height - height)
    )
  };
}

function loadHudBounds(fallback, displayBounds) {
  if (hudBoundsPath) {
    try {
      const saved = JSON.parse(readFileSync(hudBoundsPath, "utf8"));
      if (isValidHudBounds(saved)) {
        return clampHudBounds(saved, displayBounds);
      }
    }
    catch {
      // A missing or malformed layout file falls back to the current display.
    }
  }

  return fallback;
}

function saveHudBounds() {
  if (!hudWindow || hudWindow.isDestroyed() || !hudBoundsPath) return;

  try {
    writeFileSync(
      hudBoundsPath,
      JSON.stringify(hudWindow.getBounds()),
      "utf8"
    );
  }
  catch (error) {
    console.warn(
      "Apex HUD bounds unavailable:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function scheduleHudBoundsSave() {
  clearTimeout(hudBoundsSaveTimer);
  hudBoundsSaveTimer = setTimeout(() => {
    hudBoundsSaveTimer = undefined;
    saveHudBounds();
  }, 120);
}

async function showHudWindow() {
  if (!hudWindow || hudWindow.isDestroyed()) {
    const appRoot = app.getAppPath();
    const appIconPath = path.join(appRoot, "public", "assets", "ApexLogo.ico");
    const display = screen.getPrimaryDisplay();
    const fallbackBounds = display.bounds;
    const bounds = loadHudBounds(fallbackBounds, display.bounds);
    hudWindow = new BrowserWindow({
      ...bounds,
      minWidth: 640,
      minHeight: 360,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      resizable: true,
      skipTaskbar: true,
      show: false,
      icon: appIconPath,
      title: "Kynolith Apex // HUD",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(appRoot, "electron", "preload.cjs")
      }
    });
    hudWindow.on("closed", () => {
      hudWindow = undefined;
    });
    hudWindow.on("moved", scheduleHudBoundsSave);
    hudWindow.on("resized", scheduleHudBoundsSave);
    await hudWindow.loadURL(`http://127.0.0.1:${hudServerPort}/?hud=1`);
  }

  hudWindow.setAlwaysOnTop(true, "floating");
  setHudLocked(false);
  hudWindow.setIgnoreMouseEvents(false);
  hudWindow.show();
  mainWindow?.hide();
}

function closeHudWindow() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    setHudLocked(false);
    hudWindow.hide();
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function setHudLocked(locked) {
  hudLocked = Boolean(locked);
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.setIgnoreMouseEvents(hudLocked, { forward: true });
    hudWindow.webContents.send("apex:hud-lock-state", hudLocked);
  }
}

function setHudControlsInteractive(interactive) {
  if (!hudLocked || !hudWindow || hudWindow.isDestroyed()) return;

  hudWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

ipcMain.handle("apex:open-hud", () => showHudWindow());
ipcMain.handle("apex:close-hud", () => closeHudWindow());
ipcMain.handle("apex:set-hud-locked", (_event, locked) => setHudLocked(locked));
ipcMain.handle(
  "apex:set-hud-controls-interactive",
  (_event, interactive) => setHudControlsInteractive(Boolean(interactive))
);

async function createWindow() {
  process.env.KYNOLITH_DESKTOP = "1";
  app.setAppUserModelId("com.kynolith.apex.lmucoach");
  const appRoot = app.getAppPath();
  const appIconPath = path.join(appRoot, "public", "assets", "ApexLogo.ico");
  const appIcon = nativeImage.createFromPath(appIconPath);
  const serverModuleUrl = pathToFileURL(path.join(appRoot, "dist", "server.js")).href;
  const { startCoachServer } = await import(serverModuleUrl);
  const userData = app.getPath("userData");
  hudBoundsPath = path.join(userData, "hud-window-bounds.json");
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

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#060605",
    icon: appIconPath,
    autoHideMenuBar: true,
    title: "Kynolith Apex // LMU Coach",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(appRoot, "electron", "preload.cjs")
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
    if (process.platform === "win32") {
      mainWindow.setAppDetails({
        appId: "com.kynolith.apex.lmucoach",
        appIconPath
      });
    }
  }
  hudServerPort = coachServer.port;
  await mainWindow.loadURL(`http://127.0.0.1:${coachServer.port}`);
  if (!globalShortcut.register("CommandOrControl+Shift+H", () => setHudLocked(!hudLocked))) {
    console.warn("Apex HUD shortcut is unavailable; use the HUD lock control while unlocked.");
  }
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
  bridgeProcess.stderr.on("data", chunk => {
    writeBridgeDiagnostic(process.stderr, `[LMU bridge] ${chunk}`);
  });
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
  clearTimeout(hudBoundsSaveTimer);
  hudBoundsSaveTimer = undefined;
  globalShortcut.unregisterAll();
  saveHudBounds();
  hudWindow?.destroy();
  bridgeProcess?.kill();
  coachServer?.close().catch(() => {});
});
