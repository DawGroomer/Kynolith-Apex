import assert from "node:assert/strict";
import test from "node:test";
import { buildDriverProfile } from "./driver-profile.js";
import type { SessionSummary } from "./types.js";

const session = (id: string, at: number, time: number, smoothness: number): SessionSummary => ({
  id, startedAt: at, endedAt: at + 100_000, track: "Fuji Speedway", vehicle: "LMGT3", session: "practice",
  laps: [{ lap: 2, durationSeconds: time, maxSpeedMph: 170, averageSpeedMph: 105, brakingSmoothness: smoothness, throttleSmoothness: smoothness, complete: true }],
  fastestLapSeconds: time, consistencySeconds: 1, maxSpeedMph: 170, coachCueCount: 4, primaryFocus: "Smooth the brake release."
});

test("driver profile reports improvement against a comparable previous session", () => {
  const profile = buildDriverProfile("Will", [session("new", 200, 100, 90), session("old", 100, 105, 70)]);
  assert.equal(profile.driverName, "Will");
  assert.equal(profile.trend, "improved");
  assert.ok((profile.change ?? 0) > 0);
  assert.equal(profile.completedLaps, 2);
});
