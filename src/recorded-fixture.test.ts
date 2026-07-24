import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { CoachingEngine } from "./coaching.js";
import type { TelemetryFrame } from "./types.js";

test("sanitized LMU fixture replays race-control, weather, lockup, and puncture events", async () => {
  const fixture = JSON.parse(await readFile(new URL("../test/fixtures/lmu-recorded-race-control.json", import.meta.url), "utf8")) as { schemaVersion: number; frames: TelemetryFrame[] };
  assert.equal(fixture.schemaVersion, 1);
  const engine = new CoachingEngine();
  const cues = fixture.frames.flatMap(frame => engine.ingest(frame));
  for (const prefix of ["local-yellow-", "blue-flag-", "new-penalty-", "rain-increase-", "wheel-lock-", "severe-damage-"]) {
    assert.equal(cues.some(cue => cue.id.startsWith(prefix)), true, `missing ${prefix}`);
  }
});
