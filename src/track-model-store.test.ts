import assert from "node:assert/strict";
import test from "node:test";
import { discoverTrackModel } from "./track-model-store.js";
import { simulatedFrame } from "./simulator.js";
import type { RecordedSession } from "./types.js";

test("discovers reusable corner zones on an unknown track", () => {
  const frames = Array.from({ length: 201 }, (_, i) => { const distance=i/200, corner=[.15,.45,.75].some(center=>Math.abs(distance-center)<.035); return { ...simulatedFrame(100_000+i*500), track:"New Circuit", lap:2, lapDistance:distance,
    brake:corner ? .4 : 0, steering:corner ? .3 : 0, lateralG:corner ? 1.1 : 0, throttle:corner ? .1 : 1 }; });
  const session: RecordedSession={summary:{id:"session-track",startedAt:1,endedAt:2,track:"New Circuit",vehicle:"Car",session:"practice",laps:[{lap:2,durationSeconds:100,maxSpeedMph:150,averageSpeedMph:90,brakingSmoothness:90,throttleSmoothness:90,complete:true}],fastestLapSeconds:100,consistencySeconds:null,maxSpeedMph:150,coachCueCount:0,primaryFocus:"test"},frames,cues:[]};
  const model=discoverTrackModel(session);
  assert.equal(model?.source,"learned");
  assert.equal(model?.corners.length,3);
});
