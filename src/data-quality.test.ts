import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLapQuality, applyCorpusQuality, assessSessionQuality, shouldSplitSession } from "./data-quality.js";
import type { SessionSummary } from "./types.js";
import { simulatedFrame } from "./simulator.js";

function lapFrames(options: { count?: number; durationMs?: number; speedKph?: number } = {}) {
  const count = options.count ?? 1_100, duration = options.durationMs ?? 110_000;
  return Array.from({ length: count }, (_, index) => ({ ...simulatedFrame(1_000_000 + index * duration / (count - 1)),
    timestamp: 1_000_000 + index * duration / (count - 1), lap: 2, lapDistance: index / (count - 1), speedKph: options.speedKph ?? 160 }));
}

test("trusts a continuous representative lap", () => {
  const lap = analyzeLapQuality(2, lapFrames());
  assert.equal(lap.complete, true);
  assert.equal(lap.quality?.status, "trusted");
  assert.ok((lap.quality?.score ?? 0) >= 90);
});

test("quarantines stationary and implausibly long traces instead of awarding smoothness", () => {
  const lap = analyzeLapQuality(2, lapFrames({ durationMs: 700_000, speedKph: 0 }));
  assert.equal(lap.complete, false);
  assert.equal(lap.quality?.status, "quarantined");
  assert.equal(lap.brakingSmoothness, 0);
  assert.equal(lap.throttleSmoothness, 0);
});

test("limited partial laps do not make a session trusted", () => {
  const partial = analyzeLapQuality(1, lapFrames({ count: 80, durationMs: 20_000 }).map(frame => ({ ...frame, lapDistance: frame.lapDistance * .4 })));
  const quality = assessSessionQuality([partial], partial.frames);
  assert.notEqual(quality.status, "trusted");
  assert.equal(quality.score, 0);
});

test("session boundary detector catches telemetry stalls and lap resets", () => {
  const previous = lapFrames({ count: 2 })[0]!, next = { ...previous, timestamp: previous.timestamp + 6_000 };
  assert.match(shouldSplitSession(previous, next) ?? "", /five seconds/);
  assert.match(shouldSplitSession(previous, { ...previous, timestamp: previous.timestamp + 100, lap: 5 }) ?? "", /Lap counter/);
});

test("corpus baseline quarantines an otherwise continuous implausibly slow lap", () => {
  const summary = (id: string, seconds: number): SessionSummary => {
    const { frames: _frames, ...lap } = analyzeLapQuality(2, lapFrames({ durationMs: seconds * 1_000 }));
    return { id, startedAt: 1, endedAt: 2, track: "Fuji", vehicle: "LMGT3", session: "practice", laps: [lap], fastestLapSeconds: seconds,
      consistencySeconds: null, maxSpeedMph: 100, coachCueCount: 0, primaryFocus: "Test", quality: assessSessionQuality([lap], []) };
  };
  const [credible, corrupt] = applyCorpusQuality([summary("credible", 110), summary("corrupt", 390)]);
  assert.equal(credible!.laps[0]!.quality?.status, "trusted");
  assert.equal(corrupt!.laps[0]!.quality?.status, "quarantined");
  assert.equal(corrupt!.fastestLapSeconds, null);
});
