import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("HUD uses the Apex racing-overlay foundation and primary telemetry hierarchy", async () => {
  const css = await fs.readFile(
    path.resolve("public/hud.css"),
    "utf8"
  );

  for (const token of [
    "--hud-bg",
    "--hud-panel",
    "--hud-panel-strong",
    "--hud-line",
    "--hud-line-strong",
    "--hud-accent",
    "--hud-value",
    "--hud-muted",
    "--hud-throttle",
    "--hud-brake"
  ]) {
    assert.match(
      css,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  }

  for (const selector of [
    ".hud-shell",
    ".hud-topbar",
    ".hud-grid",
    ".hud-card",
    ".hud-primary",
    ".hud-input",
    ".hud-input-head",
    ".hud-input-value",
    ".hud-pedal-canvas",
    '[data-hud-field="speed"]',
    '[data-hud-field="gear"]'
  ]) {
    assert.ok(
      css.includes(selector),
      `missing racing HUD selector: ${selector}`
    );
  }

  assert.match(
    css,
    /body\.hud-mode/
  );

  assert.match(
    css,
    /font-variant-numeric:\s*tabular-nums/
  );
});