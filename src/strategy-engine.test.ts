import assert from "node:assert/strict";
import test from "node:test";
import { analyzeStrategy } from "./strategy-engine.js";
import { simulatedFrame } from "./simulator.js";
import type { RecordedSession } from "./types.js";

test("calculates fuel range and tire trend from representative laps", () => {
  const frames = [1, 2].flatMap(lap => Array.from({ length: 101 }, (_, i) => ({ ...simulatedFrame(lap * 200_000 + i * 1000), lap, lapDistance: i / 100,
    fuelLiters: 50 - (lap - 1) * 3 - i * .03, tireWear: [.98 - (lap - 1) * .01 - i * .0001, .98 - (lap - 1) * .01 - i * .0001, .98 - (lap - 1) * .01 - i * .0001, .98 - (lap - 1) * .01 - i * .0001] as [number,number,number,number] })));
  const summary = { id: "session-strategy", startedAt: 1, endedAt: 2, track: "Test", vehicle: "Car", session: "race" as const,
    laps: [1,2].map(lap => ({ lap, durationSeconds: 100 + lap, maxSpeedMph: 150, averageSpeedMph: 90, brakingSmoothness: 90, throttleSmoothness: 90, complete: true })),
    fastestLapSeconds: 101, consistencySeconds: .5, maxSpeedMph: 150, coachCueCount: 0, primaryFocus: "test" };
  const report = analyzeStrategy({ summary, frames, cues: [] });
  assert.ok((report.fuelPerLapGallons ?? 0) > .7);
  assert.ok((report.estimatedLapsRemaining ?? 0) > 10);
});
