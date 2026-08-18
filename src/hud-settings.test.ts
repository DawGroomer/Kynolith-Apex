import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsStore } from "./settings.js";

test("HUD preferences have safe defaults and persist", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "kynolith-hud-settings-")
  );

  try {
    const file = path.join(root, "settings.json");

    const store = new SettingsStore(file);
    await store.initialize();

    const defaults = store.get() as any;

    assert.equal(defaults.autoHudMode, true);
    assert.equal(defaults.hudAlwaysOnTop, false);

    assert.deepEqual(
      defaults.hudVisibleFields,
      [
        "speed",
        "gear",
        "throttle",
        "brake",
        "cue",
        "lap",
        "position",
        "fuel"
      ]
    );

    const updated = await store.update({
      autoHudMode: false,
      hudAlwaysOnTop: true,
      hudVisibleFields: [
        "gear",
        "fuel",
        "not-a-real-field",
        "gear"
      ]
    } as any);

    assert.equal((updated as any).autoHudMode, false);
    assert.equal((updated as any).hudAlwaysOnTop, true);

    assert.deepEqual(
      (updated as any).hudVisibleFields,
      ["gear", "fuel"]
    );

    const reloaded = new SettingsStore(file);
    await reloaded.initialize();

    const persisted = reloaded.get() as any;

    assert.equal(persisted.autoHudMode, false);
    assert.equal(persisted.hudAlwaysOnTop, true);

    assert.deepEqual(
      persisted.hudVisibleFields,
      ["gear", "fuel"]
    );
  }
  finally {
    await fs.rm(root, {
      recursive: true,
      force: true
    });
  }
});