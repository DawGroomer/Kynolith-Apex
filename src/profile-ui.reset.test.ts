import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startCoachServer } from "./server.js";

test("served Driver Profile UI exposes guarded new-profile reset control", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apex-profile-ui-"));

  const server = await startCoachServer({
    port: 0,
    publicDir: path.resolve("public"),
    dataDir: tmp,
    allowModelDownloads: false,
    prewarmVoices: false
  });

  try {
    const base = `http://127.0.0.1:${server.port}`;

    const htmlResponse = await fetch(`${base}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();

    assert.match(html, /id="newProfile"/);
    assert.match(html, />START NEW PROFILE</);

    const appResponse = await fetch(`${base}/app.js`);
    assert.equal(appResponse.status, 200);
    const app = await appResponse.text();

    assert.match(app, /\$\("newProfile"\)/);
    assert.match(app, /\/api\/profile\/reset/);
    assert.match(app, /method\s*:\s*"POST"/);
    assert.match(app, /confirm\(/);
    assert.match(app, /Start a new profile\?/);
    assert.match(app, /erase all recorded sessions/i);
    assert.match(app, /loadProfile\(\)/);
  } finally {
    await server.close();

    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});
