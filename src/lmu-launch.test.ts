import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("dashboard exposes a bounded LMU launch control", async () => {
  const app = await readFile(path.join(repositoryRoot, "public/app.js"), "utf8");

  assert.match(app, /button\.id="launchLmu"/);
  assert.match(app, /message\.id="launchLmuMessage"/);
  assert.match(app, /function updateLmuLaunchControl\(/);
  assert.match(app, /LAUNCH LMU/);
  assert.match(app, /STARTING LMU\.\.\./);
  assert.match(app, /LMU CONNECTED/);
  assert.match(app, /LMU TELEMETRY LIVE/);
});

test("renderer invokes the preload launcher without caller-controlled arguments", async () => {
  const app = await readFile(path.join(repositoryRoot, "public/app.js"), "utf8");

  assert.match(app, /desktopBridge\.launchLmu\(\)/);
  assert.doesNotMatch(app, /desktopBridge\.launchLmu\(\s*[^)]/);
  assert.match(app, /lmuLaunchPending/);
  assert.match(app, /if\([^)]*lmuLaunchPending/);
});

test("preload exposes the fixed LMU launch IPC method", async () => {
  const preload = await readFile(
    path.join(repositoryRoot, "electron/preload.cjs"),
    "utf8"
  );

  assert.match(
    preload,
    /launchLmu:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("apex:launch-lmu"\)/
  );
});

test("main owns the exact Steam URI and does not accept a renderer launch target", async () => {
  const main = await readFile(path.join(repositoryRoot, "electron/main.cjs"), "utf8");

  assert.match(main, /const LMU_STEAM_URI\s*=\s*["']steam:\/\/run\/2399420["']/);
  assert.match(main, /ipcMain\.handle\(["']apex:launch-lmu["'],\s*async\s*\(\)\s*=>/);
  assert.match(main, /shell\.openExternal\(LMU_STEAM_URI\)/);
  assert.doesNotMatch(main, /spawn\([^)]*["']steam\.exe["']/i);
  assert.doesNotMatch(main, /PowerShell|cmd\.exe/i);
});

test("Steam launch failure is bounded and leaves the control usable", async () => {
  const app = await readFile(path.join(repositoryRoot, "public/app.js"), "utf8");

  assert.match(app, /Unable to launch LMU through Steam\./);
  assert.match(app, /catch[\s\S]{0,500}Unable to launch LMU through Steam\./);
  assert.match(app, /finally[\s\S]{0,300}lmuLaunchPending\s*=\s*false/);
});

test("connected LMU state disables launch behavior", async () => {
  const app = await readFile(path.join(repositoryRoot, "public/app.js"), "utf8");

  assert.match(
    app,
    /source\s*===\s*["']lmu["'][\s\S]{0,180}connected\s*===\s*true/
  );
  assert.match(app, /button\.disabled\s*=\s*connected\s*\|\|\s*lmuLaunchPending/);
  assert.match(app, /button\.textContent\s*=\s*connected/);
});
