import assert from "node:assert/strict";
import test from "node:test";
import { applyScoreCalibration, buildScoreCalibration, type ExpertLabel } from "./score-calibration.js";

test("expert-labelled sessions calibrate raw technique scores and expose error", () => {
  const labels: ExpertLabel[] = Array.from({ length: 40 }, (_, index) => 20 + index * 1.8).map(value => ({ id: String(value), raw: { braking: value, throttle: value, consistency: value, pace: value }, expert: { braking: value * .9 + 5, throttle: value * .9 + 5, consistency: value * .9 + 5, pace: value * .9 + 5 } }));
  const calibration = buildScoreCalibration(labels);
  const result = applyScoreCalibration({ braking: 70, throttle: 70, consistency: 70, pace: 70 }, calibration);
  assert.equal(result.braking, 68.3);
  assert.ok(calibration.models.braking.meanAbsoluteError < .01);
  assert.ok(calibration.models.braking.crossValidatedMae < .1);
  assert.equal(calibration.status, "validated");
});

test("calibration refuses an unrepresentative label set", () => {
  assert.throws(() => buildScoreCalibration([]), /12 expert-labelled/);
});

test("calibration refuses narrow score coverage", () => {
  const labels: ExpertLabel[] = Array.from({ length: 12 }, (_, index) => ({ id: String(index), raw: { braking: 70 + index / 10, throttle: 70 + index / 10, consistency: 70 + index / 10, pace: 70 + index / 10 },
    expert: { braking: 70, throttle: 70, consistency: 70, pace: 70 } }));
  assert.throws(() => buildScoreCalibration(labels), /30 points of raw-score coverage/);
});
