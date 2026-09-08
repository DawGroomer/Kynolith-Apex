import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

test("Apex exposes a separate compact HUD presentation shell", async () => {
  const html = await fs.readFile(
    path.resolve("public/index.html"),
    "utf8"
  );

  const app = await fs.readFile(
    path.resolve("public/app.js"),
    "utf8"
  );

  assert.match(
    html,
    /id="hudView"/
  );

  assert.match(
    html,
    /id="hudExit"/
  );

  for (const field of [
    "speed",
    "gear",
    "throttle",
    "brake",
    "cue",
    "session",
    "lap",
    "position",
    "gap",
    "fuel",
    "tire",
    "pressure",
    "rpm",
    "source"
  ]) {
    assert.match(
      html,
      new RegExp(`data-hud-field="${field}"`)
    );
  }

  assert.match(
    app,
    /function shouldUseHud/
  );

  assert.match(
    app,
    /sessionActive/
  );

  assert.match(
    app,
    /settings\.autoHudMode/
  );

  assert.match(
    app,
    /function renderHud/
  );

  assert.match(
    app,
    /function applyPresentationMode/
  );

  assert.match(
    app,
    /hudModeOverride/
  );

  assert.equal(
    (app.match(/let hudModeOverride=null;/g) ?? []).length,
    1
  );

  assert.equal(
    (app.match(/function shouldUseHud/g) ?? []).length,
    1
  );

  assert.equal(
    (app.match(/function renderHud/g) ?? []).length,
    1
  );

  assert.equal(
    (app.match(/\$\("hudEnter"\)\.onclick/g) ?? []).length,
    1
  );

  execFileSync(
    process.execPath,
    ["--check", path.resolve("public/app.js")],
    { stdio: "pipe" }
  );
});
