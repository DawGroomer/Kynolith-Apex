import assert from "node:assert/strict";
import test from "node:test";
import { StrategyCoach } from "./strategy-coach.js";
import { simulatedFrame } from "./simulator.js";

test("calls a race fuel window from measured lap usage", () => {
  const coach = new StrategyCoach();
  coach.ingest({ ...simulatedFrame(100_000), session:"race", lap:1, fuelLiters:9 });
  coach.ingest({ ...simulatedFrame(200_000), session:"race", lap:2, fuelLiters:6 });
  const cues=coach.ingest({ ...simulatedFrame(300_000), session:"race", lap:3, fuelLiters:3 });
  assert.equal(cues[0]?.message,"Fuel critical. Pit this lap.");
});
