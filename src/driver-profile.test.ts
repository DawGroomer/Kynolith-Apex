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
  assert.equal(profile.academy.rank, "Rookie");
  assert.ok(profile.academy.requirements.length > 0);
  assert.ok(profile.academy.drill.instructions.length > 20);
});

test("academy promotion requires volume and balanced mastery", () => {
  const sessions = Array.from({ length: 16 }, (_, index) => ({ ...session(`s${index}`, 10_000 - index, 100, 96), track: `Track ${index % 3}`, vehicle: `Car ${index % 3}`,
    consistencySeconds: .2, laps: Array.from({ length: 4 }, (_, lap) => ({ lap: lap + 1, durationSeconds: 100 + lap * .1, maxSpeedMph: 170,
      averageSpeedMph: 105, brakingSmoothness: 96, throttleSmoothness: 96, complete: true })) }));
  const profile = buildDriverProfile("Will", sessions);
  assert.equal(profile.academy.rank, "Prodigy");
  assert.equal(profile.academy.promotionProgress, 100);
});

test("quarantined history cannot depress progression or inflate completed laps", () => {
  const trusted = session("trusted", 100, 100, 85);
  trusted.quality = { version: 3, status: "trusted", score: 95, confidence: "high", reasons: [], sampleCount: 1_000 };
  trusted.laps[0]!.quality = { version: 3, status: "trusted", score: 95, confidence: "high", reasons: [], sampleCount: 1_000 };
  const corrupt = session("corrupt", 200, 700, 100);
  corrupt.quality = { version: 3, status: "quarantined", score: 0, confidence: "low", reasons: ["Implausible duration"], sampleCount: 1_000 };
  corrupt.laps[0] = { ...corrupt.laps[0]!, complete: false, quality: { version: 3, status: "quarantined", score: 0, confidence: "low", reasons: ["Implausible duration"], sampleCount: 1_000 } };
  const profile = buildDriverProfile("Will", [corrupt, trusted]);
  assert.equal(profile.completedLaps, 1);
  assert.equal(profile.dataQuality.trustedSessions, 1);
  assert.equal(profile.dataQuality.quarantinedSessions, 1);
  assert.notEqual(profile.trend, "declined");
});

test("fragmented implausibly fast laps cannot become the pace baseline", () => {
  const clean = session("clean", 300, 107, 85);
  clean.laps = [106.9, 107.4, 108.1].map((durationSeconds, index) => ({ ...clean.laps[0]!, lap: index + 1, durationSeconds }));
  clean.fastestLapSeconds = 106.9;
  const previous = session("previous", 200, 109, 82);
  previous.laps = [108.8, 109.2, 109.5].map((durationSeconds, index) => ({ ...previous.laps[0]!, lap: index + 1, durationSeconds }));
  previous.fastestLapSeconds = 108.8;
  const fragment = session("fragment", 100, 72, 90);
  fragment.fastestLapSeconds = 72;
  const profile = buildDriverProfile("Will", [clean, previous, fragment]);
  assert.ok((profile.components?.pace ?? 0) >= 99);
  assert.notEqual(profile.components?.pace, 0);
});
