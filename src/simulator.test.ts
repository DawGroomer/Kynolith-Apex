import assert from "node:assert/strict";
import test from "node:test";
import { simulatedFrame } from "./simulator.js";

test("simulator uses a session-relative lap number instead of Unix time", () => {
  const start = 1_754_389_800_000;
  assert.equal(simulatedFrame(start, start).lap, 1);
  assert.equal(simulatedFrame(start + 89_999, start).lap, 1);
  assert.equal(simulatedFrame(start + 90_000, start).lap, 2);
});
