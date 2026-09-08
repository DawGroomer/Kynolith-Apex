import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("Electron HUD is a native transparent click-through overlay", async () => {
  const [main, app, html, hudCss, preload] = await Promise.all([
    readFile(path.join(repositoryRoot, "electron/main.cjs"), "utf8"),
    readFile(path.join(repositoryRoot, "public/app.js"), "utf8"),
    readFile(path.join(repositoryRoot, "public/index.html"), "utf8"),
    readFile(path.join(repositoryRoot, "public/hud.css"), "utf8"),
    readFile(path.join(repositoryRoot, "electron/preload.cjs"), "utf8")
  ]);

  assert.match(main, /transparent:\s*true/);
  assert.match(main, /frame:\s*false/);
  assert.match(main, /alwaysOnTop:\s*true/);
  assert.match(main, /backgroundColor:\s*["']#00000000["']/);
  assert.match(main, /setIgnoreMouseEvents\(/);
  assert.match(main, /screen\.getAllDisplays\(\)/);
  assert.match(main, /apex:get-hud-displays/);
  assert.match(main, /apex:set-hud-display-target/);
  assert.match(main, /getBounds\(\)/);
  assert.match(main, /"moved"/);
  assert.match(main, /"resized"/);
  assert.match(main, /writeFileSync/);
  assert.match(app, /openHud/);
  assert.match(app, /closeHud/);
  assert.match(app, /setHudLocked/);
  assert.match(app, /apex-hud-layout-v1/);
  assert.match(app, /localStorage/);
  assert.match(app, /pointerdown/);
  assert.match(app, /--hud-scale/);
  assert.match(app, /data-hud-close/);
  assert.match(app, /visible:false/);
  assert.match(app, /hudRestore/);
  assert.match(preload, /getHudDisplays/);
  assert.match(preload, /setHudDisplayTarget/);
  assert.match(html, /id="hudLock"/);
  assert.match(html, /id="hudRestore"/);
  assert.match(html, /id="hudDisplayTarget"/);
  assert.match(html, /Span All Displays/);
  assert.equal((html.match(/data-hud-module=/g) ?? []).length, 4);
  assert.equal((html.match(/hud-resize-handle/g) ?? []).length, 4);
  assert.equal((html.match(/data-hud-close/g) ?? []).length, 4);
  assert.match(hudCss, /background:\s*transparent\s*!important/);
  assert.match(hudCss, /position:\s*fixed/);
});

test("locked HUD keeps close controls interactive without disabling click-through", async () => {
  const [main, preload, app, hudCss] = await Promise.all([
    readFile(path.join(repositoryRoot, "electron/main.cjs"), "utf8"),
    readFile(path.join(repositoryRoot, "electron/preload.cjs"), "utf8"),
    readFile(path.join(repositoryRoot, "public/app.js"), "utf8"),
    readFile(path.join(repositoryRoot, "public/hud.css"), "utf8"),
  ]);

  assert.match(main, /apex:set-hud-controls-interactive/);
  assert.match(preload, /setHudControlsInteractive/);
  assert.match(app, /elementFromPoint/);
  assert.match(app, /hud-actions, \.hud-close/);
  assert.doesNotMatch(
    app,
    /module\.querySelector\("\[data-hud-close\]"\)\?\.addEventListener\("click",event=>\{\s*if\(hudLocked\)return;/
  );
  assert.match(hudCss, /hud-locked \.hud-close[\s\S]*pointer-events:\s*auto/);
});

test("HUD uses the stronger Windows overlay level for game foreground", async () => {
  const main = await readFile(
    path.join(repositoryRoot, "electron/main.cjs"),
    "utf8"
  );

  assert.match(
    main,
    /hudWindow\.setAlwaysOnTop\(true,\s*["']screen-saver["']\)/
  );
  assert.doesNotMatch(
    main,
    /hudWindow\.setAlwaysOnTop\(true,\s*["']floating["']\)/
  );
});
