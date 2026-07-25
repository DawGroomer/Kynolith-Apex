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

test("persists measured voice engine, latency, and fallback outcome", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apex-audio-"));
  const recorder = new SessionRecorder(directory); await recorder.initialize();
  const frame = simulatedFrame(200_000); await recorder.recordFrame(frame);
  const cue = { id: "car-right-200000", at: 200_000, expiresAt: 202_500, priority: "critical" as const, category: "racecraft" as const, message: "Car right.", speak: true, delayInHardPart: false };
  recorder.recordCue(cue, frame);
  assert.equal(recorder.recordAudioDelivery(cue.id, { measuredAt: 200_140, telemetryEventAt: 200_000, queuedAt: 200_010, requestToPlaybackMs: 130, telemetryToPlaybackMs: 140, queueDelayMs: 5, synthesisMs: 0, playbackStartedAt: 200_140, engine: "kokoro-q8", voice: "am_fenrir", role: "spotter", cacheHit: true, outcome: "played", fallbackReason: null, deadlineMet: true }), true);
  for (let index = 1; index < 25; index++) await recorder.recordFrame({ ...frame, timestamp: 200_000 + index * 100, lapDistance: index / 100 });
  const summary = await recorder.finish(); assert.ok(summary);
  const stored = JSON.parse(await readFile(path.join(directory, `${summary.id}.json`), "utf8"));
  assert.equal(stored.cues[0].audioDelivery.engine, "kokoro-q8"); assert.equal(stored.cues[0].audioDelivery.deadlineMet, true);
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
