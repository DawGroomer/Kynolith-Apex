import assert from "node:assert/strict";
import test from "node:test";
import { CoachingEngine } from "./coaching.js";
import { simulatedFrame } from "./simulator.js";

test("yellow flag produces a critical safety cue", () => {
  const engine = new CoachingEngine();
  engine.ingest({ ...simulatedFrame(100_000), yellowFlag: true });
  const cue = engine.ingest({ ...simulatedFrame(100_100), yellowFlag: true })[0];
  assert.equal(cue?.priority, "critical");
  assert.equal(cue?.category, "safety");
});

test("cooldown suppresses repeated yellow calls", () => {
  const engine = new CoachingEngine();
  assert.equal(engine.ingest({ ...simulatedFrame(100_000), yellowFlag: true }).length, 0);
  assert.equal(engine.ingest({ ...simulatedFrame(100_100), yellowFlag: true }).length, 1);
  assert.equal(engine.ingest({ ...simulatedFrame(120_000), yellowFlag: true }).filter(cue => cue.id.startsWith("yellow-")).length, 0);
});

test("spotter calls a car alongside and then clear", () => {
  const engine = new CoachingEngine();
  engine.ingest({ ...simulatedFrame(100_000), carLeft: true });
  engine.ingest({ ...simulatedFrame(100_100), carLeft: true });
  const left = engine.ingest({ ...simulatedFrame(100_150), carLeft: true });
  assert.equal(left.some(cue => cue.message.startsWith("Car left")), true);
  assert.equal(engine.ingest({ ...simulatedFrame(101_000), carLeft: true }).some(cue => cue.message.startsWith("Car left")), false);
  engine.ingest({ ...simulatedFrame(102_000), carLeft: false });
  engine.ingest({ ...simulatedFrame(102_400), carLeft: false });
  const clear = engine.ingest({ ...simulatedFrame(102_500), carLeft: false });
  assert.equal(clear.some(cue => cue.message === "Clear left."), true);
});

test("spotter ignores brief overlap and clear noise", () => {
  const engine = new CoachingEngine();
  const noisyEntry = [0, 60, 120].flatMap((offset, index) => engine.ingest({ ...simulatedFrame(200_000 + offset), carRight: index < 2 }));
  assert.equal(noisyEntry.some(cue => cue.id.startsWith("car-right-")), false);
  engine.ingest({ ...simulatedFrame(201_000), carRight: true });
  const entry = engine.ingest({ ...simulatedFrame(201_150), carRight: true });
  assert.equal(entry.some(cue => cue.id.startsWith("car-right-")), true);
  engine.ingest({ ...simulatedFrame(201_300), carRight: false });
  const noise = engine.ingest({ ...simulatedFrame(201_650), carRight: true });
  assert.equal(noise.some(cue => cue.id.startsWith("clear-right-")), false);
});

test("coach checks in during otherwise clean running", () => {
  const engine = new CoachingEngine();
  engine.ingest(simulatedFrame(100_000));
  const cues = engine.ingest(simulatedFrame(120_000));
  assert.equal(cues.some(cue => cue.id.startsWith("coach-checkin-")), true);
});

test("yellow warning resets only after a green frame", () => {
  const engine = new CoachingEngine();
  assert.equal(engine.ingest({ ...simulatedFrame(100_000), yellowFlag: true }).length, 0);
  assert.equal(engine.ingest({ ...simulatedFrame(100_100), yellowFlag: true }).length, 1);
  assert.equal(engine.ingest({ ...simulatedFrame(101_000), yellowFlag: false }).length, 0);
  assert.equal(engine.ingest({ ...simulatedFrame(102_000), yellowFlag: true }).length, 0);
  assert.equal(engine.ingest({ ...simulatedFrame(102_100), yellowFlag: true }).length, 1);
});

test("race control ignores a transient yellow during initialization", () => {
  const engine = new CoachingEngine();
  assert.equal(engine.ingest({ ...simulatedFrame(100_000), sectorYellow: true }).length, 0);
  assert.equal(engine.ingest({ ...simulatedFrame(100_125), sectorYellow: false }).some(cue => cue.id.startsWith("local-yellow-")), false);
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

test("spin detection replaces the track-limits call with recovery guidance", () => {
  const engine = new CoachingEngine();
  engine.ingest({ ...simulatedFrame(300_000), speedKph: 100, lateralSpeedKph: 38, offTrackWheels: 2 });
  const cues = engine.ingest({ ...simulatedFrame(300_050), speedKph: 85, lateralSpeedKph: 35, offTrackWheels: 2 });
  const followup = engine.ingest({ ...simulatedFrame(300_100), speedKph: 60, lateralSpeedKph: 30, offTrackWheels: 2 });
  assert.equal(cues.some(cue => cue.id.startsWith("spin-") && cue.category === "safety"), true);
  assert.equal(followup.some(cue => cue.id.startsWith("track-edge-")), false);
});

test("impact telemetry produces crash recovery guidance", () => {
  const engine = new CoachingEngine();
  engine.ingest({ ...simulatedFrame(400_000), impactTimestamp: 10, impactMagnitude: 0 });
  const cues = engine.ingest({ ...simulatedFrame(400_050), impactTimestamp: 11, impactMagnitude: 8, offTrackWheels: 4 });
  assert.equal(cues.some(cue => cue.id.startsWith("impact-") && cue.message.startsWith("Impact.")), true);
  assert.equal(cues.some(cue => cue.id.startsWith("track-edge-")), false);
});

test("race control distinguishes local yellow, blue flag, and a new penalty", () => {
  const engine = new CoachingEngine();
  const initial = engine.ingest({ ...simulatedFrame(500_000), sectorYellow: true, blueFlag: true, penalties: 0 });
  const first = engine.ingest({ ...simulatedFrame(500_100), sectorYellow: true, blueFlag: true, penalties: 0 });
  const second = engine.ingest({ ...simulatedFrame(500_200), sectorYellow: true, blueFlag: true, penalties: 1 });
  assert.equal(first.some(cue => cue.id.startsWith("local-yellow-")), true);
  assert.equal([...initial, ...first].some(cue => cue.id.startsWith("blue-flag-")), true);
  assert.equal(second.some(cue => cue.id.startsWith("new-penalty-")), true);
});

test("wheel and weather telemetry produce actionable safety calls", () => {
  const engine = new CoachingEngine();
  const damage = engine.ingest({ ...simulatedFrame(600_000), wheelFlat: [true, false, false, false], raining: .4 });
  assert.equal(damage.some(cue => cue.id.startsWith("severe-damage-") && cue.priority === "critical"), true);
  assert.equal(damage.some(cue => cue.id.startsWith("rain-increase-")), true);
});
