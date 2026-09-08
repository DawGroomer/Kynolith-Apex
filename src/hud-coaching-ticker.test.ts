import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function readHudSources() {
  const [app, html, css] = await Promise.all([
    readFile(path.join(repositoryRoot, "public/app.js"), "utf8"),
    readFile(path.join(repositoryRoot, "public/index.html"), "utf8"),
    readFile(path.join(repositoryRoot, "public/hud.css"), "utf8")
  ]);

  return { app, html, css };
}

test("dedicated HUD is visual-only while the dashboard owns cue speech", async () => {
  const { app } = await readHudSources();

  assert.match(
    app,
    /if\(m\.cue&&!dedicatedHud\)speakCue\(m\.cue\)/,
    "incoming coaching cues must be spoken only by the normal dashboard renderer"
  );
});

test("normal dashboard still speaks incoming coaching cues", async () => {
  const { app } = await readHudSources();

  assert.match(
    app,
    /if\(m\.cue&&!dedicatedHud\)speakCue\(m\.cue\)/,
    "the dashboard renderer must remain the single speech authority"
  );
  assert.doesNotMatch(
    app,
    /if\(dedicatedHud\)\s*\{?\s*speakCue\(/,
    "the dedicated HUD must not initiate speech"
  );
});

test("HUD voice module is removed without removing coaching", async () => {
  const { html } = await readHudSources();

  assert.doesNotMatch(html, /data-hud-module="voice"/);
  assert.doesNotMatch(html, /id="hudVoiceStatus"/);
  assert.match(html, /data-hud-module="coaching"/);
});

test("HUD coaching is a single-line ticker", async () => {
  const { html, css } = await readHudSources();

  assert.match(html, /class="hud-cue-ticker"/);
  assert.match(html, /id="hudCue"[^>]*class="hud-cue-ticker-message"/);
  assert.match(css, /\.hud-cue-ticker[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.hud-cue-ticker[^}]*overflow:\s*hidden/);
});

test("overflowing HUD coaching text uses bounded horizontal scrolling", async () => {
  const { app, css } = await readHudSources();

  assert.match(app, /const overflowing=message\.scrollWidth>viewport\.clientWidth/);
  assert.match(app, /hud-ticker-overflow/);
  assert.match(css, /@keyframes\s+hud-ticker-scroll/);
  assert.match(css, /\.hud-ticker-overflow[^}]*animation:/);
});

test("short HUD coaching text remains static", async () => {
  const { app, css } = await readHudSources();

  assert.match(
    app,
    /if\(!overflowing\)\{[\s\S]*remove\("hud-ticker-overflow"\)/,
    "non-overflowing cues must clear ticker animation"
  );
  assert.match(
    css,
    /\.hud-cue-ticker-message\s*\{[^}]*white-space:\s*nowrap/
  );
});

test("new HUD cues replace the old message and reset ticker position", async () => {
  const { app } = await readHudSources();

  assert.match(app, /message\.textContent=messageText/);
  assert.match(app, /message\.classList\.remove\("hud-ticker-overflow"\)/);
  assert.match(app, /message\.style\.removeProperty\("--hud-ticker-distance"\)/);
});

test("legacy HUD voice layout entries are ignored while known modules persist", async () => {
  const { app } = await readHudSources();
  const defaults = app.match(/const HUD_LAYOUT_KEY[\s\S]*?let hudLayout=/)?.[0] ?? "";

  assert.doesNotMatch(defaults, /voice\s*:/);
  assert.doesNotMatch(app, /dedicatedRequired[^;]*voiceStatus/);
  assert.match(app, /for\(const \[key,defaults\] of Object\.entries\(hudLayoutDefaults\)\)/);
});
