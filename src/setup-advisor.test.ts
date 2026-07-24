import assert from "node:assert/strict";
import test from "node:test";
import { buildSetupReport } from "./setup-advisor.js";
import { simulatedFrame } from "./simulator.js";
import type { RecordedSession } from "./types.js";

function session(laps = 2): RecordedSession {
  const frames = Array.from({ length: laps }, (_, lapIndex) => Array.from({ length: 101 }, (_, index) => ({ ...simulatedFrame(100_000 + lapIndex * 120_000 + index * 1000),
    lap: lapIndex + 1, lapDistance: index / 100, speedKph: 140, tireTempC: [98, 97, 85, 84] as [number, number, number, number], tirePressurePsi: [27, 27.2, 25, 25.1] as [number, number, number, number],
    offTrackWheels: 0, lapInvalidated: false }))).flat();
  return { summary: { id: "session-setup", startedAt: 1, endedAt: 2, track: "Fuji Speedway", vehicle: "test", session: "practice",
    laps: Array.from({ length: laps }, (_, i) => ({ lap: i + 1, durationSeconds: 100 + i * .2, maxSpeedMph: 150, averageSpeedMph: 90, brakingSmoothness: 95, throttleSmoothness: 95, complete: true })),
    fastestLapSeconds: 100, consistencySeconds: laps > 1 ? .1 : null, maxSpeedMph: 150, coachCueCount: 0, primaryFocus: "test" }, frames, cues: [] };
}

test("blocks setup advice without representative laps", () => {
  const report = buildSetupReport(session(1));
  assert.equal(report.status, "not-ready");
  assert.ok(report.blockers.length > 0);
});

test("provides one-change setup experiments from repeatable evidence", () => {
  const report = buildSetupReport(session(2));
  assert.equal(report.status, "setup-ready");
  assert.ok(report.diagnoses.some(item => item.id === "temperature-balance"));
  assert.ok(report.diagnoses.every(item => item.validation.length > 10));
});
