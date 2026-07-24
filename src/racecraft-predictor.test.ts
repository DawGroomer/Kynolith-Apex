import assert from "node:assert/strict";
import test from "node:test";
import { RacecraftPredictor } from "./racecraft-predictor.js";
import { simulatedFrame } from "./simulator.js";

test("predicts a faster class arriving from behind", () => {
  const predictor = new RacecraftPredictor();
  predictor.ingest({ ...simulatedFrame(100_000), session: "race", vehicleClass: "LMGT3", opponentBehindClass: "Hypercar", opponentBehindDistanceMeters: 30 });
  const cues = predictor.ingest({ ...simulatedFrame(100_500), session: "race", vehicleClass: "LMGT3", opponentBehindClass: "Hypercar", opponentBehindDistanceMeters: 25 });
  assert.equal(cues[0]?.message, "Faster class closing. Stay predictable.");
});

test("ignores same-class and implausible gap jumps", () => {
  const predictor = new RacecraftPredictor();
  predictor.ingest({ ...simulatedFrame(100_000), session: "race", vehicleClass: "LMGT3", opponentBehindClass: "LMGT3", opponentBehindDistanceMeters: 80 });
  assert.equal(predictor.ingest({ ...simulatedFrame(100_100), session: "race", vehicleClass: "LMGT3", opponentBehindClass: "LMGT3", opponentBehindDistanceMeters: 1 }).length, 0);
});
