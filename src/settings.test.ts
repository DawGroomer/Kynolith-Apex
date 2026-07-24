import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsStore, spacingFor } from "./settings.js";

test("settings persist and clamp unsafe values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kynolith-settings-"));
  const file = path.join(root, "settings.json");
  const store = new SettingsStore(file);
  await store.initialize();
  const updated = await store.update({ voiceVolume: 8, voiceRate: .1, speechFrequency: "active", controllerButton: 9, swearingLevel: 99 });
  assert.equal(updated.voiceVolume, 1);
  assert.equal(updated.voiceRate, .8);
  assert.equal(updated.controllerButton, 9);
  assert.equal(updated.swearingLevel, 3);
  const reloaded = new SettingsStore(file); await reloaded.initialize();
  assert.equal(reloaded.get().speechFrequency, "active");
  assert.equal(spacingFor("quiet"), 12_000);
  await fs.rm(root, { recursive: true, force: true });
});
