import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("Electron gates GitHub update checks behind the persisted opt-in", async () => {
  const source = await fs.readFile("electron/main.cjs", "utf8");

  assert.match(
    source,
    /require\("\.\/update-check\.cjs"\)/
  );

  assert.match(
    source,
    /\/api\/settings/
  );

  assert.match(
    source,
    /enabled:\s*settings\.autoCheckUpdates\s*===\s*true/
  );

  assert.match(
    source,
    /currentVersion:\s*app\.getVersion\(\)/
  );

  assert.match(
    source,
    /result\.status\s*!==\s*"available"/
  );

  assert.match(
    source,
    /shell\.openExternal\(result\.url\)/
  );
});

test("Electron update wiring does not download or install releases", async () => {
  const source = await fs.readFile("electron/main.cjs", "utf8");

  assert.doesNotMatch(source, /autoUpdater/);
  assert.doesNotMatch(source, /downloadUpdate/);
  assert.doesNotMatch(source, /quitAndInstall/);
});
