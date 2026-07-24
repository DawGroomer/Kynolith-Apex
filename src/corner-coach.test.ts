import assert from "node:assert/strict";
import test from "node:test";
import { CornerCoach } from "./corner-coach.js";
import { simulatedFrame } from "./simulator.js";

test("corner coach reviews a completed brake-turn-exit sequence", () => {
  const coach = new CornerCoach(); const cues = [];
  for (let i = 0; i < 35; i++) cues.push(...coach.ingest({ ...simulatedFrame(100_000 + i * 100), lap: 1, lapDistance: .2 + i * .001,
    speedKph: 150 - i, brake: i < 8 ? .7 - i * .04 : 0, steering: i > 5 && i < 26 ? .35 : 0, lateralG: i > 5 && i < 26 ? 1.1 : 0, throttle: i > 29 ? .7 : 0 }, true));
  assert.equal(cues.some(cue => cue.id.startsWith("corner-review-")), true);
  assert.equal(cues.every(cue => cue.message.split(/\s+/).length <= 8), true);
});

test("corner coach stays silent in the pits", () => {
  const coach = new CornerCoach(); const cues = [];
  for (let i = 0; i < 30; i++) cues.push(...coach.ingest({ ...simulatedFrame(200_000 + i * 100), inPits: true,
    brake: i < 10 ? .7 : 0, steering: i > 5 && i < 20 ? .4 : 0, throttle: i > 20 ? .8 : 0 }, true));
  assert.equal(cues.length, 0);
});
