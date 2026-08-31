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
let hudDisplayTarget = "primary-display";
let hudDisplayModule;
let quitting = false;
let shutdownPromise;
let shutdownComplete = false;
let finalQuitRequested = false;
const LMU_STEAM_URI = "steam://run/2399420";
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

async function getHudDisplayModule() {
  if (!hudDisplayModule) {
    hudDisplayModule = await import(
      pathToFileURL(path.join(app.getAppPath(), "dist", "hud-display.js")).href
    );
  }
  return hudDisplayModule;
}

function readSavedHudBounds() {
  if (!hudBoundsPath) return undefined;

  try {
    return JSON.parse(readFileSync(hudBoundsPath, "utf8"));
  }
  catch {
    return undefined;
  }
}

function currentHudDisplays() {
  return screen.getAllDisplays().map(display => ({
    id: String(display.id),
    bounds: { ...display.bounds }
  }));
}

async function persistHudDisplayTarget(target) {
  if (!hudServerPort) return;

  try {
    await fetch(`http://127.0.0.1:${hudServerPort}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hudDisplayTarget: target })
    });
  }
  catch (error) {
    console.warn(
      "Apex HUD display fallback could not be persisted:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function resolveHudSurface(useSavedBounds = true) {
  const displayModule = await getHudDisplayModule();
  const displays = currentHudDisplays();
  const primary = screen.getPrimaryDisplay();
  const resolved = displayModule.resolveHudSurface(
    displays,
    hudDisplayTarget,
    String(primary.id),
    useSavedBounds ? readSavedHudBounds() : undefined
  );

  if (resolved.fellBack) {
    hudDisplayTarget = resolved.target;
    mainWindow?.webContents.send("apex:hud-display-fallback", {
      target: resolved.target,
      message: "Saved HUD display is unavailable. Using the primary display."
    });
    void persistHudDisplayTarget(resolved.target);
  }

  return {
    ...resolved,
    displays,
    options: displayModule.enumerateHudDisplays(displays, String(primary.id))
  };
}

async function loadHudDisplayTarget() {
  if (!hudServerPort) return;

  try {
    const response = await fetch(`http://127.0.0.1:${hudServerPort}/api/settings`);
    if (!response.ok) return;
    const settings = await response.json();
    if (typeof settings.hudDisplayTarget === "string") {
      hudDisplayTarget = settings.hudDisplayTarget;
    }
  }
  catch {
    // The primary display remains the safe in-memory default.
  }
}

async function applyHudDisplayTarget() {
  const resolved = await resolveHudSurface(false);
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.setBounds(resolved.bounds);
    scheduleHudBoundsSave();
  }
  return resolved;
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
  await loadHudDisplayTarget();
  if (!hudWindow || hudWindow.isDestroyed()) {
    const appRoot = app.getAppPath();
    const appIconPath = path.join(appRoot, "public", "assets", "ApexLogo.ico");
    const { bounds } = await resolveHudSurface(true);
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
    hudWindow.on("close", event => {
      if (quitting) return;
      event.preventDefault();
      app.quit();
    });
    hudWindow.on("closed", () => {
      hudWindow = undefined;
    });
    hudWindow.on("moved", scheduleHudBoundsSave);
    hudWindow.on("resized", scheduleHudBoundsSave);
    await hudWindow.loadURL(`http://127.0.0.1:${hudServerPort}/?hud=1`);
  }

  hudWindow.setAlwaysOnTop(true, "screen-saver");
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
ipcMain.handle("apex:launch-lmu", async () => {
  try {
    await shell.openExternal(LMU_STEAM_URI);
    return { ok: true };
  } catch (error) {
    console.warn(
      "Unable to launch LMU through Steam:",
      error instanceof Error ? error.message : String(error)
    );
    return {
      ok: false,
      message: "Unable to launch LMU through Steam."
    };
  }
});
ipcMain.handle("apex:close-hud", () => closeHudWindow());
ipcMain.handle("apex:set-hud-locked", (_event, locked) => setHudLocked(locked));
ipcMain.handle("apex:get-hud-displays", async () => {
  await loadHudDisplayTarget();
  return resolveHudSurface(true);
});
ipcMain.handle("apex:set-hud-display-target", async (_event, target) => {
  hudDisplayTarget = typeof target === "string" && target.trim()
    ? target.trim().slice(0, 80)
    : "primary-display";
  return applyHudDisplayTarget();
});
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
      : path.join(appRoot, "offline-models"),
    ...(app.isPackaged
      ? { allowModelDownloads: false }
      : { allowModelDownloads: true }),
    bundledModelsManifest: path.join(
      appRoot,
      "config",
      "bundled-model-manifest.json"
    )
  });
  startTelemetryBridge(coachServer);

  const refreshHudSurface = () => {
    if (hudWindow && !hudWindow.isDestroyed()) void applyHudDisplayTarget();
  };
  screen.on("display-added", refreshHudSurface);
  screen.on("display-removed", refreshHudSurface);
  screen.on("display-metrics-changed", refreshHudSurface);

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
  const child = spawn(executable, [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  bridgeProcess = child;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    try {
      const frame = JSON.parse(line);
      if (!Number.isFinite(frame.timestamp) || !Number.isFinite(frame.speedKph)) return;
      lastFrameAt = Date.now();
      disconnectReported = false;
      server.ingestTelemetry(frame);
    } catch { /* Ignore partial or diagnostic output; bridge reconnects independently. */ }
  });
  child.stderr.on("data", chunk => {
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
      child.kill();
    }
  }, 1000);
  child.on("exit", () => {
    clearInterval(telemetryWatchdog);
    if (bridgeProcess === child) bridgeProcess = undefined;
    if (!quitting) {
      server.disconnectTelemetry().catch(() => {});
      bridgeRestartTimer = setTimeout(() => startTelemetryBridge(server), 2000);
    }
  });
}

function waitForBridgeExit(child) {
  return new Promise(resolve => {
    let settled = false;
    const timeout = setTimeout(() => {
      console.warn("Apex bridge did not exit before the shutdown timeout.");
      settle();
    }, 5000);
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("exit", settle);
      if (bridgeProcess === child) bridgeProcess = undefined;
      resolve();
    };

    if (
      (child.exitCode !== null && child.exitCode !== undefined) ||
      (child.signalCode !== null && child.signalCode !== undefined)
    ) {
      settle();
      return;
    }

    child.once("exit", settle);
    try {
      child.kill();
    }
    catch (error) {
      console.warn(
        "Apex bridge termination request failed:",
        error instanceof Error ? error.message : String(error)
      );
      settle();
    }
  });
}

function requestShutdown() {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    quitting = true;
    clearTimeout(bridgeRestartTimer);
    clearInterval(telemetryWatchdog);
    clearInterval(updateCheckTimer);
    clearTimeout(hudBoundsSaveTimer);
    hudBoundsSaveTimer = undefined;
    globalShortcut.unregisterAll();
    saveHudBounds();
    if (hudWindow && !hudWindow.isDestroyed()) hudWindow.destroy();
    hudWindow = undefined;

    const child = bridgeProcess;
    const bridgeShutdown = child
      ? waitForBridgeExit(child)
      : Promise.resolve();
    const server = coachServer;
    const serverShutdown = server
      ? Promise.resolve()
        .then(() => server.close())
        .catch(error => {
          console.warn(
            "Apex server shutdown failed:",
            error instanceof Error ? error.message : String(error)
          );
        })
      : Promise.resolve();

    await Promise.all([bridgeShutdown, serverShutdown]);
    shutdownComplete = true;
  })();

  return shutdownPromise;
}

app.whenReady().then(createWindow).catch(error => {
  dialog.showErrorBox("Kynolith Apex failed to start", error?.stack || String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (finalQuitRequested) return;

  event.preventDefault();
  void requestShutdown().then(() => {
    if (finalQuitRequested || !shutdownComplete) return;
    finalQuitRequested = true;
    app.quit();
  });
});
