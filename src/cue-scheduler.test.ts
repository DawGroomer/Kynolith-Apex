import assert from "node:assert/strict";
import test from "node:test";
import { CueScheduler } from "./cue-scheduler.js";
import { simulatedFrame } from "./simulator.js";
import type { CoachingCue } from "./types.js";

const cue = (overrides: Partial<CoachingCue> = {}): CoachingCue => ({
  id: "cue", at: 10_000, expiresAt: 20_000, priority: "technique", category: "braking",
  message: "Brake smoothly", speak: true, delayInHardPart: true, ...overrides
});

test("delays technique calls in hard sections", () => {
  const scheduler = new CueScheduler(); scheduler.enqueue([cue()]);
  assert.equal(scheduler.next({ ...simulatedFrame(11_000), brake: 0.8 }), null);
  assert.equal(scheduler.next({ ...simulatedFrame(12_000), brake: 0, lateralG: 0, steering: 0 })?.id, "cue");
});

test("critical call bypasses hard-section delay", () => {
  const scheduler = new CueScheduler(); scheduler.enqueue([cue({ priority: "critical", category: "safety", delayInHardPart: false })]);
  assert.equal(scheduler.next({ ...simulatedFrame(11_000), brake: 0.8 })?.priority, "critical");
});

test("new technique call replaces stale technique advice", () => {
  const scheduler = new CueScheduler();
  scheduler.enqueue([cue({ id: "old", at: 10_000 })]);
  scheduler.enqueue([cue({ id: "new", at: 11_000, message: "Smoother release" })]);
  assert.equal(scheduler.next({ ...simulatedFrame(12_000), brake: 0, lateralG: 0, steering: 0 })?.id, "new");
});
