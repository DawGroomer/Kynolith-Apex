import assert from "node:assert/strict";
import test from "node:test";
import { buildLmuGrounding, selectLmuKnowledge } from "./lmu-knowledge.js";
import { simulatedFrame } from "./simulator.js";
import type { CoachState } from "./types.js";

test("retrieves LMU-specific knowledge for traction control questions", () => {
  const cards = selectLmuKnowledge("Why is TC power cut hurting my corner exit?");
  assert.equal(cards[0]?.id, "traction-control");
  assert.match(cards[0]?.guidance ?? "", /slip-angle/i);
});

test("grounds the local coach with exact telemetry and relevant knowledge", () => {
  const state: CoachState = {
    connected: true,
    source: "lmu",
    frame: { ...simulatedFrame(), vehicle: "Porsche 963", track: "Spa-Francorchamps" },
    lastCue: null,
    bestLapSeconds: null,
    lastLapSeconds: null,
    consistencySeconds: null
  };
  const grounding = buildLmuGrounding("How should I manage virtual energy?", state, null);
  assert.match(grounding, /Porsche 963/);
  assert.match(grounding, /Spa-Francorchamps/);
  assert.match(grounding, /Hypercar virtual energy/);
  assert.doesNotMatch(grounding, /Do not claim current car state/i);
});

test("does not fabricate live telemetry when LMU is disconnected", () => {
  const state: CoachState = {
    connected: false,
    source: "simulator",
    frame: null,
    lastCue: null,
    bestLapSeconds: null,
    lastLapSeconds: null,
    consistencySeconds: null
  };
  assert.match(buildLmuGrounding("What are my tire pressures?", state, null), /Unavailable\. Do not claim current car state/);
});
