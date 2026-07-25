import assert from "node:assert/strict";
import test from "node:test";
import { ShiftCoach } from "./shift-coach.js";
import { simulatedFrame } from "./simulator.js";

function frame(timestamp: number, values: Partial<ReturnType<typeof simulatedFrame>> = {}) {
  return { ...simulatedFrame(timestamp), inPits: false, speedKph: 140, gear: 3, rpm: 7_800, throttle: 1, brake: 0, steering: 0, ...values };
}

function calibratedCoach(): { coach: ShiftCoach; at: number } {
  const coach = new ShiftCoach();
  let at = 100_000;
  for (let index = 0; index < 80; index++) coach.ingest(frame(at += 50));
  return { coach, at };
}

test("shift coach learns the vehicle rev range before giving advice", () => {
  const coach = new ShiftCoach();
  coach.ingest(frame(100_000, { gear: 2, rpm: 4_500 }));
  const cues = coach.ingest(frame(100_100, { gear: 3, rpm: 3_800 }));
  assert.equal(cues.length, 0);
});

test("shift coach identifies late and early upshifts", () => {
  const { coach, at } = calibratedCoach();
  assert.equal(coach.ingest(frame(at + 100, { gear: 4, rpm: 6_400 })).some(cue => cue.id.startsWith("shift-up-late-")), true);
  coach.ingest(frame(at + 500, { gear: 4, rpm: 5_000 }));
  assert.equal(coach.ingest(frame(at + 700, { gear: 5, rpm: 4_300 })).some(cue => cue.id.startsWith("shift-up-early-")), true);
});

test("shift coach detects an over-revving downshift", () => {
  const { coach, at } = calibratedCoach();
  coach.ingest(frame(at + 100, { gear: 4, rpm: 6_000, throttle: 0, brake: 1 }));
  const cues = coach.ingest(frame(at + 300, { gear: 3, rpm: 7_700, throttle: 0, brake: 1 }));
  assert.equal(cues.some(cue => cue.id.startsWith("shift-down-overrev-")), true);
});
