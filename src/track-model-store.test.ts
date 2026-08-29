import assert from "node:assert/strict";
import test from "node:test";

import {
  access,
  mkdtemp,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";

import {
  TrackModelStore,
  discoverTrackModel
} from "./track-model-store.js";

import {
  simulatedFrame
} from "./simulator.js";

import type {
  RecordedSession,
  TrackModel
} from "./types.js";

test("discovers reusable corner zones on an unknown track", () => {
  const frames = Array.from({ length: 201 }, (_, i) => { const distance=i/200, corner=[.15,.45,.75].some(center=>Math.abs(distance-center)<.035); return { ...simulatedFrame(100_000+i*500), track:"New Circuit", lap:2, lapDistance:distance,
    brake:corner ? .4 : 0, steering:corner ? .3 : 0, lateralG:corner ? 1.1 : 0, throttle:corner ? .1 : 1 }; });
  const session: RecordedSession={summary:{id:"session-track",startedAt:1,endedAt:2,track:"New Circuit",vehicle:"Car",session:"practice",laps:[{lap:2,durationSeconds:100,maxSpeedMph:150,averageSpeedMph:90,brakingSmoothness:90,throttleSmoothness:90,complete:true}],fastestLapSeconds:100,consistencySeconds:null,maxSpeedMph:150,coachCueCount:0,primaryFocus:"test"},frames,cues:[]};
  const model=discoverTrackModel(session);
  assert.equal(model?.source,"learned");
  assert.equal(model?.corners.length,3);
});


test(
  "returns a persisted learned model without discovery",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-matching-"
        )
      );

    try {
      const persisted: TrackModel = {
        track: "Persisted Circuit",
        version: 1,
        source: "learned",

        corners: [
          {
            id: "persisted-c1",
            name: "Corner 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          },
          {
            id: "persisted-c2",
            name: "Corner 2",
            entry: 0.40,
            apex: 0.45,
            exit: 0.50
          },
          {
            id: "persisted-c3",
            name: "Corner 3",
            entry: 0.70,
            apex: 0.75,
            exit: 0.80
          }
        ]
      };

      await writeFile(
        path.join(
          directory,
          "persisted-circuit.json"
        ),
        JSON.stringify(persisted),
        "utf8"
      );

      const store =
        new TrackModelStore(
          directory
        );

      const matching =
        (
          store as unknown as {
            matching?: (
              track: string
            ) => Promise<
              TrackModel | null
            >;
          }
        ).matching;

      assert.equal(
        typeof matching,
        "function"
      );

      if (
        typeof matching !==
        "function"
      ) {
        return;
      }

      const result =
        await matching.call(
          store,
          "Persisted Circuit"
        );

      assert.deepEqual(
        result,
        persisted
      );
    }
    finally {
      await rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);



test(
  "curated model takes precedence over persisted learned model",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-curated-"
        )
      );

    try {
      const fakePersisted: TrackModel = {
        track: "Fuji Speedway",
        version: 99,
        source: "learned",

        corners: [
          {
            id: "fake-c1",
            name: "Fake Corner",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      };

      await writeFile(
        path.join(
          directory,
          "fuji-speedway.json"
        ),
        JSON.stringify(
          fakePersisted
        ),
        "utf8"
      );

      const store =
        new TrackModelStore(
          directory
        );

      const result =
        await store.matching(
          "Fuji Speedway"
        );

      assert.equal(
        result?.source,
        "curated"
      );

      assert.equal(
        result?.track,
        "Fuji Speedway"
      );

      assert.notDeepEqual(
        result,
        fakePersisted
      );
    }
    finally {
      await rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);


test(
  "missing track returns null without writing a model",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-missing-"
        )
      );

    try {
      const store =
        new TrackModelStore(
          directory
        );

      const result =
        await store.matching(
          "Definitely Unknown Circuit"
        );

      assert.equal(
        result,
        null
      );

      assert.deepEqual(
        await readdir(
          directory
        ),
        []
      );
    }
    finally {
      await rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);


test(
  "resolve reuses matching before discovery",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-resolve-"
        )
      );

    try {
      const matched: TrackModel = {
        track: "Delegated Circuit",
        version: 7,
        source: "learned",

        corners: [
          {
            id: "delegated-c1",
            name: "Delegated Corner 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          },
          {
            id: "delegated-c2",
            name: "Delegated Corner 2",
            entry: 0.40,
            apex: 0.45,
            exit: 0.50
          },
          {
            id: "delegated-c3",
            name: "Delegated Corner 3",
            entry: 0.70,
            apex: 0.75,
            exit: 0.80
          }
        ]
      };

      class MatchingProbeStore
        extends TrackModelStore {
        matchingCalls = 0;

        override async matching(
          track: string
        ): Promise<TrackModel | null> {
          this.matchingCalls++;

          assert.equal(
            track,
            "Delegated Circuit"
          );

          return matched;
        }
      }

      const store =
        new MatchingProbeStore(
          directory
        );

      const session: RecordedSession = {
        summary: {
          id: "delegation-session",
          startedAt: 1,
          endedAt: 2,
          track: "Delegated Circuit",
          vehicle: "Car",
          session: "practice",
          laps: [],
          fastestLapSeconds: null,
          consistencySeconds: null,
          maxSpeedMph: 0,
          coachCueCount: 0,
          primaryFocus: "test"
        },

        frames: [],
        cues: []
      };

      const result =
        await store.resolve(
          session
        );

      assert.equal(
        store.matchingCalls,
        1
      );

      assert.deepEqual(
        result,
        matched
      );
    }
    finally {
      await rm(
        directory,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);



test(
  "matching does not create storage when no model exists",
  async () => {
    const parent =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-readonly-"
        )
      );

    const directory =
      path.join(
        parent,
        "models"
      );

    try {
      const store =
        new TrackModelStore(
          directory
        );

      const result =
        await store.matching(
          "No Such Circuit"
        );

      assert.equal(
        result,
        null
      );

      await assert.rejects(
        access(
          directory
        ),
        (
          error: unknown
        ) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
      );
    }
    finally {
      await rm(
        parent,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);
