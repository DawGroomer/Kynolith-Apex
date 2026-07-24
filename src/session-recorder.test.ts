import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionRecorder } from "./session-recorder.js";
import { simulatedFrame } from "./simulator.js";

test("records and summarizes a telemetry session in American units", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apex-session-"));
  const recorder = new SessionRecorder(directory); await recorder.initialize();
  for (let i = 0; i < 220; i++) {
    const timestamp = 100_000 + i * 500;
    await recorder.recordFrame({ ...simulatedFrame(timestamp), timestamp, lap: Math.floor(i / 100) + 1, lapDistance: (i % 100) / 100 });
  }
  const summary = await recorder.finish();
  assert.ok(summary); assert.ok(summary.maxSpeedMph > 100); assert.equal(summary.laps.length, 3);
  const stored = JSON.parse(await readFile(path.join(directory, `${summary.id}.json`), "utf8"));
  assert.equal(stored.summary.track, "Circuit de la Sarthe");
});
