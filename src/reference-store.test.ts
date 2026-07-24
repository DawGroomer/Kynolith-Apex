import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReferenceStore } from "./reference-store.js";
import { simulatedFrame } from "./simulator.js";

test("imports and retrieves a persistent expert reference", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apex-reference-"));
  try {
    const store = new ReferenceStore(directory);
    const frames = Array.from({ length: 101 }, (_, index) => ({ ...simulatedFrame(100_000 + index * 1000), track: "Fuji Speedway", vehicle: "Test Car", lap: 2, lapDistance: index / 100 }));
    const imported = await store.import({ name: "Coach Lap", frames });
    assert.equal(imported.name, "Coach Lap");
    assert.equal((await store.list()).length, 1);
    const match = await store.matching("Fuji Speedway", "Test Car");
    assert.equal(match?.frames.length, 101);
    assert.equal(match?.lapTimeSeconds, 100);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
