import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("user-facing local model copy does not claim packaged Apex downloads models on first use", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");

  assert.doesNotMatch(
    html,
    /first use downloads offline models/i
  );

  assert.doesNotMatch(
    app,
    /first use may download models/i
  );

  assert.match(
    html,
    /Local voice ready .* models run locally/i
  );

  assert.match(
    app,
    /Transcribing locally/
  );
});
