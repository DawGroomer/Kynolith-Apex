import assert from "node:assert/strict";
import test from "node:test";
import { directSpeech, roleSpeed } from "./prosody-director.js";

test("prosody director expands telemetry notation and decimals", () => {
  assert.equal(directSpeech("P3, 27.4 PSI. TC active.", "coach"), "position 3, 27 point 4 P S I. traction control active.");
});

test("spotter delivery remains concise and rate limited", () => {
  assert.equal(directSpeech("Local yellow. No overtaking; watch ahead.", "spotter", "urgent"), "Local yellow! No overtaking. watch ahead.");
  assert.equal(roleSpeed(1.25, "spotter", "urgent"), 1.12);
});
