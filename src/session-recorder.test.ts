import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionRecorder } from "./session-recorder.js";
import { summarize } from "./session-recorder.js";
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

test("consistency excludes a complete but nonrepresentative out lap", () => {
  const frames = [
    ...lapFrames(1, 100_000, 150),
    ...lapFrames(2, 300_000, 110),
    ...lapFrames(3, 500_000, 109.5),
    ...lapFrames(4, 700_000, 110.5)
  ];
  const summary = summarize({ summary: { id: "session-test", startedAt: 100_000, endedAt: 900_000, track: "Fuji Speedway", vehicle: "GT3", session: "practice", laps: [], fastestLapSeconds: null, consistencySeconds: null, maxSpeedMph: 0, coachCueCount: 0, primaryFocus: "test" }, frames, cues: [] });
  assert.ok(summary.consistencySeconds !== null && summary.consistencySeconds < 1);
});

function lapFrames(lap: number, start: number, durationSeconds: number) {
  return Array.from({ length: 120 }, (_, index) => ({ ...simulatedFrame(start + index * durationSeconds * 1000 / 119), lap, lapDistance: index / 119, speedKph: 150 }));
}
