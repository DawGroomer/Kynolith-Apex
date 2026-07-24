import assert from "node:assert/strict";
import test from "node:test";
import { CoachingEngine } from "./coaching.js";
import { simulatedFrame } from "./simulator.js";

test("yellow flag produces a critical safety cue", () => {
  const engine = new CoachingEngine();
  const frame = { ...simulatedFrame(100_000), yellowFlag: true };
  const cue = engine.ingest(frame)[0];
  assert.equal(cue?.priority, "critical");
  assert.equal(cue?.category, "safety");
});

test("cooldown suppresses repeated yellow calls", () => {
  const engine = new CoachingEngine();
  assert.equal(engine.ingest({ ...simulatedFrame(100_000), yellowFlag: true }).length, 1);
  assert.equal(engine.ingest({ ...simulatedFrame(120_000), yellowFlag: true }).filter(cue => cue.id.startsWith("yellow-")).length, 0);
});

test("spotter calls a car alongside and then clear", () => {
  const engine = new CoachingEngine();
  engine.ingest({ ...simulatedFrame(100_000), carLeft: true });
  engine.ingest({ ...simulatedFrame(100_050), carLeft: true });
  const left = engine.ingest({ ...simulatedFrame(100_100), carLeft: true });
  assert.equal(left.some(cue => cue.message.startsWith("Car left")), true);
  assert.equal(engine.ingest({ ...simulatedFrame(101_000), carLeft: true }).some(cue => cue.message.startsWith("Car left")), false);
  for (let i = 0; i < 11; i++) engine.ingest({ ...simulatedFrame(102_000 + i * 50), carLeft: false });
  const clear = engine.ingest({ ...simulatedFrame(102_550), carLeft: false });
  assert.equal(clear.some(cue => cue.message === "Clear left."), true);
});

test("coach checks in during otherwise clean running", () => {
  const engine = new CoachingEngine();
  engine.ingest(simulatedFrame(100_000));
  const cues = engine.ingest(simulatedFrame(120_000));
  assert.equal(cues.some(cue => cue.id.startsWith("coach-checkin-")), true);
});

test("yellow warning resets only after a green frame", () => {
  const engine = new CoachingEngine();
  assert.equal(engine.ingest({ ...simulatedFrame(100_000), yellowFlag: true }).length, 1);
  assert.equal(engine.ingest({ ...simulatedFrame(101_000), yellowFlag: false }).length, 0);
  assert.equal(engine.ingest({ ...simulatedFrame(102_000), yellowFlag: true }).length, 1);
});

test("track limits warning is edge triggered and lap invalidation is explicit", () => {
  const engine = new CoachingEngine();
  engine.ingest({ ...simulatedFrame(100_000), offTrackWheels: 2 });
  engine.ingest({ ...simulatedFrame(100_050), offTrackWheels: 2 });
  const edge = engine.ingest({ ...simulatedFrame(100_100), offTrackWheels: 2 });
  assert.equal(edge.some(cue => cue.id.startsWith("track-edge-")), true);
  assert.equal(engine.ingest({ ...simulatedFrame(100_150), offTrackWheels: 2 }).some(cue => cue.id.startsWith("track-edge-")), false);
  const invalid = engine.ingest({ ...simulatedFrame(100_200), lapInvalidated: true });
  assert.equal(invalid.some(cue => cue.id.startsWith("lap-invalid-")), true);
});

test("track limits does not retrigger from brief wheel-contact noise", () => {
  const engine = new CoachingEngine();
  for (let i = 0; i < 3; i++) engine.ingest({ ...simulatedFrame(200_000 + i * 50), offTrackWheels: 2 });
  for (let i = 0; i < 5; i++) engine.ingest({ ...simulatedFrame(201_000 + i * 50), offTrackWheels: 0 });
  const noisy = [2, 2, 2].flatMap((offTrackWheels, i) => engine.ingest({ ...simulatedFrame(202_000 + i * 50), offTrackWheels }));
  assert.equal(noisy.some(cue => cue.id.startsWith("track-edge-")), false);
});
