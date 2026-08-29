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


test(
  "malformed persisted JSON fails closed",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-malformed-json-"
        )
      );

    try {
      await writeFile(
        path.join(
          directory,
          "malformed-persisted-circuit.json"
        ),
        "{ not valid JSON",
        "utf8"
      );

      const store =
        new TrackModelStore(
          directory
        );

      assert.equal(
        await store.matching(
          "Malformed Persisted Circuit"
        ),
        null
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
  "structurally malformed persisted models fail closed",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-structural-invalid-"
        )
      );

    const file =
      path.join(
        directory,
        "structural-invalid-circuit.json"
      );

    const validCorner = {
      id: "structural-c1",
      name: "Structural Corner",
      entry: 0.10,
      apex: 0.15,
      exit: 0.20
    };

    const validModel = {
      track: "Structural Invalid Circuit",
      version: 1,
      source: "learned",
      corners: [validCorner]
    };

    const cases: Array<[
      string,
      Record<string, unknown>
    ]> = [
      [
        "missing corners",
        {
          track: validModel.track,
          version: validModel.version,
          source: validModel.source
        }
      ],
      [
        "corners not an array",
        {
          ...validModel,
          corners: {}
        }
      ],
      [
        "missing corner id",
        {
          ...validModel,
          corners: [{
            name: validCorner.name,
            entry: validCorner.entry,
            apex: validCorner.apex,
            exit: validCorner.exit
          }]
        }
      ],
      [
        "missing corner name",
        {
          ...validModel,
          corners: [{
            id: validCorner.id,
            entry: validCorner.entry,
            apex: validCorner.apex,
            exit: validCorner.exit
          }]
        }
      ],
      [
        "missing entry",
        {
          ...validModel,
          corners: [{
            id: validCorner.id,
            name: validCorner.name,
            apex: validCorner.apex,
            exit: validCorner.exit
          }]
        }
      ],
      [
        "missing apex",
        {
          ...validModel,
          corners: [{
            id: validCorner.id,
            name: validCorner.name,
            entry: validCorner.entry,
            exit: validCorner.exit
          }]
        }
      ],
      [
        "missing exit",
        {
          ...validModel,
          corners: [{
            id: validCorner.id,
            name: validCorner.name,
            entry: validCorner.entry,
            apex: validCorner.apex
          }]
        }
      ],
      [
        "string geometry",
        {
          ...validModel,
          corners: [{
            ...validCorner,
            entry: "0.10"
          }]
        }
      ],
      [
        "boolean geometry",
        {
          ...validModel,
          corners: [{
            ...validCorner,
            apex: true
          }]
        }
      ],
      [
        "null geometry",
        {
          ...validModel,
          corners: [{
            ...validCorner,
            exit: null
          }]
        }
      ],
      [
        "missing track",
        {
          version: validModel.version,
          source: validModel.source,
          corners: validModel.corners
        }
      ],
      [
        "invalid track",
        {
          ...validModel,
          track: 42
        }
      ],
      [
        "missing version",
        {
          track: validModel.track,
          source: validModel.source,
          corners: validModel.corners
        }
      ],
      [
        "invalid version",
        {
          ...validModel,
          version: "1"
        }
      ],
      [
        "invalid source",
        {
          ...validModel,
          source: "generated"
        }
      ]
    ];

    try {
      const store =
        new TrackModelStore(
          directory
        );

      const results: unknown[] = [];

      for (
        const [, model]
        of cases
      ) {
        await writeFile(
          file,
          JSON.stringify(model),
          "utf8"
        );

        results.push(
          await store.matching(
            "Structural Invalid Circuit"
          )
        );
      }

      assert.deepEqual(
        results,
        cases.map(() => null)
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
  "semantically invalid persisted geometry fails closed",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-semantic-invalid-"
        )
      );

    const file =
      path.join(
        directory,
        "semantic-invalid-circuit.json"
      );

    const model = (
      entry: unknown,
      apex: unknown,
      exit: unknown
    ) => ({
      track: "Semantic Invalid Circuit",
      version: 1,
      source: "learned",
      corners: [
        {
          id: "semantic-c1",
          name: "Semantic Corner",
          entry,
          apex,
          exit
        }
      ]
    });

    const cases: Array<[
      string,
      string
    ]> = [
      [
        "non-finite overflow",
        '{"track":"Semantic Invalid Circuit","version":1,"source":"learned","corners":[{"id":"semantic-c1","name":"Semantic Corner","entry":0.1,"apex":0.15,"exit":1e309}]}'
      ],
      [
        "entry below zero",
        JSON.stringify(model(-0.01, 0.15, 0.20))
      ],
      [
        "apex below zero",
        JSON.stringify(model(0.10, -0.01, 0.20))
      ],
      [
        "exit below zero",
        JSON.stringify(model(0.10, 0.15, -0.01))
      ],
      [
        "entry above one",
        JSON.stringify(model(1.01, 1.02, 1.03))
      ],
      [
        "apex above one",
        JSON.stringify(model(0.90, 1.01, 1.02))
      ],
      [
        "exit above one",
        JSON.stringify(model(0.90, 0.95, 1.01))
      ],
      [
        "entry greater than apex",
        JSON.stringify(model(0.20, 0.15, 0.30))
      ],
      [
        "apex greater than exit",
        JSON.stringify(model(0.10, 0.25, 0.20))
      ]
    ];

    try {
      const store =
        new TrackModelStore(
          directory
        );

      const results: unknown[] = [];

      for (
        const [, json]
        of cases
      ) {
        await writeFile(
          file,
          json,
          "utf8"
        );

        results.push(
          await store.matching(
            "Semantic Invalid Circuit"
          )
        );
      }

      assert.deepEqual(
        results,
        cases.map(() => null)
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
  "accepts normalized boundary corner geometry",
  async () => {
    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-track-model-boundary-"
        )
      );

    try {
      const persisted = {
        track: "Boundary Circuit",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "boundary-c1",
            name: "Boundary Corner",
            entry: 0,
            apex: 0.50,
            exit: 1
          }
        ]
      };

      await writeFile(
        path.join(
          directory,
          "boundary-circuit.json"
        ),
        JSON.stringify(persisted),
        "utf8"
      );

      const store =
        new TrackModelStore(
          directory
        );

      assert.deepEqual(
        await store.matching(
          "Boundary Circuit"
        ),
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
