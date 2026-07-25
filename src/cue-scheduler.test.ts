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

test("active coaching permits no more than three spaced technique calls per lap", () => {
  const scheduler = new CueScheduler(); scheduler.setTechniquePolicy("active");
  const spoken: string[] = [];
  for (let index = 0; index < 8; index++) {
    const timestamp = 100_000 + index * 21_000;
    scheduler.enqueue([cue({ id: `technique-${index}`, at: timestamp, expiresAt: timestamp + 5_000 })]);
    const next = scheduler.next({ ...simulatedFrame(timestamp), timestamp, lap: 2, brake: 0, lateralG: 0, steering: 0 });
    if (next) spoken.push(next.id);
  }
  assert.equal(spoken.length, 3);
  scheduler.enqueue([cue({ id: "next-lap", at: 300_000, expiresAt: 305_000 })]);
  assert.equal(scheduler.next({ ...simulatedFrame(300_000), timestamp: 300_000, lap: 3, brake: 0, lateralG: 0, steering: 0 })?.id, "next-lap");
});

test("critical call evicts queued noncritical narration", () => {
  const scheduler = new CueScheduler();
  scheduler.enqueue([cue({ id: "welcome", priority: "info", category: "lap", delayInHardPart: false })]);
  scheduler.enqueue([cue({ id: "yellow", priority: "critical", category: "safety", delayInHardPart: false })]);
  assert.equal(scheduler.next({ ...simulatedFrame(12_000), brake: 0, lateralG: 0, steering: 0 })?.id, "yellow");
  assert.equal(scheduler.next({ ...simulatedFrame(20_000), brake: 0, lateralG: 0, steering: 0 }), null);
});
