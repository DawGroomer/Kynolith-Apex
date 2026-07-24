import assert from "node:assert/strict";
import test from "node:test";
import { applyScoreCalibration, buildScoreCalibration, type ExpertLabel } from "./score-calibration.js";

test("expert-labelled sessions calibrate raw technique scores and expose error", () => {
  const labels: ExpertLabel[] = [40, 60, 80, 90].map(value => ({ id: String(value), raw: { braking: value, throttle: value, consistency: value, pace: value }, expert: { braking: value * .9 + 5, throttle: value * .9 + 5, consistency: value * .9 + 5, pace: value * .9 + 5 } }));
  const calibration = buildScoreCalibration(labels);
  const result = applyScoreCalibration({ braking: 70, throttle: 70, consistency: 70, pace: 70 }, calibration);
  assert.equal(result.braking, 68);
  assert.ok(calibration.models.braking.meanAbsoluteError < .01);
});

test("calibration refuses an unrepresentative label set", () => {
  assert.throws(() => buildScoreCalibration([]), /three expert-labelled/);
});
