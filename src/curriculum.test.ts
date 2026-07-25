import assert from "node:assert/strict";
import test from "node:test";
import { curriculumForRank, scoreTechnique, selectFocusedCorner } from "./curriculum.js";
import { simulatedFrame } from "./simulator.js";
import type { CornerPerformance } from "./types.js";

test("academy ranks select the four curriculum phases", () => {
  assert.equal(curriculumForRank("Rookie").level, 0);
  assert.equal(curriculumForRank("Advanced").level, 1);
  assert.equal(curriculumForRank("Expert").level, 2);
  assert.equal(curriculumForRank("Prodigy").level, 3);
});

test("technique scoring penalizes abrupt loaded inputs", () => {
  const smooth = Array.from({ length: 12 }, (_, i) => ({ ...simulatedFrame(1_000 + i * 50), speedKph: 100, steering: i * .01, brake: Math.max(0, .6 - i * .04), throttle: i < 8 ? 0 : (i - 8) * .08 }));
  const abrupt = smooth.map((frame, i) => ({ ...frame, steering: i % 2 ? .55 : -.35, brake: i % 2 ? .7 : 0, throttle: i % 2 ? 1 : 0 }));
  const good = scoreTechnique(smooth), bad = scoreTechnique(abrupt);
  assert.ok(good.steeringEfficiency > bad.steeringEfficiency);
  assert.ok(good.trailBrake > bad.trailBrake);
});

test("focused drill selects the largest repeatable corner loss and sets a staged recovery target", () => {
  const corner = (id: string, name: string, deltaSeconds: number): CornerPerformance => ({ cornerId: id, name, lap: 2, timeSeconds: 5, deltaSeconds, minSpeedMph: 60, exitSpeedMph: 80, peakBrake: .7, brakePoint: .1, throttlePoint: .2, grade: "loss", cueMessages: [], uncertaintySeconds: .1, confidence: "moderate" });
  const drill = selectFocusedCorner([corner("one", "Turn 1", .1), corner("two", "Dunlop", .3), corner("two", "Dunlop", .2)]);
  assert.equal(drill?.corner, "Dunlop");
  assert.equal(drill?.recoveryTargetSeconds, .05);
  assert.equal(drill?.executionPlan.length, 3);
  assert.match(drill?.successCriteria ?? "", /three consecutive clean laps/i);
});
