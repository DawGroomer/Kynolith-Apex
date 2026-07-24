import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSessionIntelligence, identifyCorner, trackModel } from "./track-intelligence.js";
import { simulatedFrame } from "./simulator.js";
import type { RecordedSession } from "./types.js";

test("identifies persistent Fuji corner zones", () => {
  assert.equal(trackModel("Fuji Speedway")?.corners.length, 9);
  assert.equal(identifyCorner("Fuji Speedway", .165)?.name, "Turn 1");
  assert.equal(identifyCorner("Unknown", .165), null);
});

test("builds corner deltas, skills, and theoretical best", () => {
  const frames = [1, 2].flatMap(lap => Array.from({ length: 101 }, (_, i) => ({ ...simulatedFrame(lap * 200_000 + i * 1000), track: "Fuji Speedway", lap, lapDistance: i / 100 })));
  const session: RecordedSession = { summary: { id: "session-1", startedAt: 1, endedAt: 2, track: "Fuji Speedway", vehicle: "test", session: "practice",
    laps: [1, 2].map(lap => ({ lap, durationSeconds: 100, maxSpeedMph: 100, averageSpeedMph: 80, brakingSmoothness: 90, throttleSmoothness: 88, complete: true })),
    fastestLapSeconds: 100, consistencySeconds: 0, maxSpeedMph: 100, coachCueCount: 0, primaryFocus: "test" }, frames, cues: [] };
  const result = analyzeSessionIntelligence(session);
  assert.equal(result.referenceLap, 1);
  assert.equal(result.reference?.source, "session");
  assert.equal(result.corners.length, 18);
  assert.equal(result.theoreticalBestSeconds, 80);
});

test("expert reference takes priority without replacing personal best", () => {
  const frames = Array.from({ length: 101 }, (_, i) => ({ ...simulatedFrame(300_000 + i * 1000), track: "Fuji Speedway", vehicle: "test", lap: 1, lapDistance: i / 100 }));
  const session: RecordedSession = { summary: { id: "session-2", startedAt: 1, endedAt: 2, track: "Fuji Speedway", vehicle: "test", session: "practice",
    laps: [{ lap: 1, durationSeconds: 100, maxSpeedMph: 100, averageSpeedMph: 80, brakingSmoothness: 90, throttleSmoothness: 90, complete: true }],
    fastestLapSeconds: 100, consistencySeconds: null, maxSpeedMph: 100, coachCueCount: 0, primaryFocus: "test" }, frames, cues: [] };
  const result = analyzeSessionIntelligence(session, { label: "PB", lapTimeSeconds: 99, frames }, { id: "reference-x", name: "Expert", track: "Fuji Speedway", vehicle: "test", importedAt: 1, lapTimeSeconds: 95, frames });
  assert.equal(result.reference?.source, "expert");
  assert.equal(result.personalBestSeconds, 99);
});
