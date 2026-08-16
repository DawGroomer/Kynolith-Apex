import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("settings UI exposes explicit opt-in control for update checks", async () => {
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
    /id="autoCheckUpdates"/
  );

  assert.match(
    html,
    /Check GitHub for Apex updates/
  );

  assert.match(
    html,
    /Off by default/
  );

  assert.match(
    html,
    /Updates are never downloaded or installed automatically/
  );

  assert.match(
    app,
    /const settingIds=\[[^\]]*"autoCheckUpdates"/
  );
});
