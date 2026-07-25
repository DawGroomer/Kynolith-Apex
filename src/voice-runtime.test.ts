import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VoiceRuntime } from "./voice-runtime.js";

test("voice runtime caches rendered phrases and reports the engine", async () => {
  let renders = 0;
  const runtime = new VoiceRuntime(await mkdtemp(path.join(os.tmpdir(), "apex-voice-")), async () => { renders++; return new Uint8Array([1, 2, 3]).buffer; });
  const request = { text: "Car right.", voice: "am_fenrir", speed: 1, role: "spotter" as const, emotion: "urgent" as const, phraseKey: "car-right" };
  assert.equal((await runtime.render(request)).cacheHit, false);
  const cached = await runtime.render(request);
  assert.equal(cached.cacheHit, true); assert.equal(cached.engine, "kokoro-q8"); assert.equal(renders, 1);
});
