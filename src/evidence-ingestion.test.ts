import assert from "node:assert/strict";
import test from "node:test";

import {
  mkdtemp,
  rm
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";

import {
  ReferenceStore
} from "./reference-store.js";

import {
  SessionRecorder
} from "./session-recorder.js";

import {
  simulatedFrame
} from "./simulator.js";

import type {
  TelemetryFrame
} from "./types.js";


function lapFrames(
  lap: number,
  timestampBase: number,
  count: number,
  startDistance: number,
  endDistance: number,
  overrides: Partial<TelemetryFrame> = {}
): TelemetryFrame[] {

  return Array.from(
    { length: count },
    (_, index) => {

      const progress =
        count > 1
          ? index / (count - 1)
          : 0;

      return {
        ...simulatedFrame(
          timestampBase +
          index * 100
        ),

        timestamp:
          timestampBase +
          index * 100,

        track: "Fuji Speedway",
        vehicle: "LMGT3",
        session: "practice",

        lap,

        lapDistance:
          startDistance +
          (
            endDistance -
            startDistance
          ) * progress,

        ...overrides
      };
    }
  );
}


test(
  "reference import rejects telemetry when no single complete lap can be established",
  async () => {

    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-reference-no-lap-"
        )
      );


    try {

      const store =
        new ReferenceStore(
          directory
        );


      const frames = [
        ...lapFrames(
          1,
          100_000,
          30,
          0.10,
          0.40
        ),

        ...lapFrames(
          2,
          110_000,
          30,
          0.50,
          0.80
        )
      ];


      await assert.rejects(
        () =>
          store.import({
            name: "Invalid multi-lap reference",
            track: "Fuji Speedway",
            vehicle: "LMGT3",
            frames
          }),
        /single complete lap/i
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
  "reference import rejects a selected lap with mixed vehicle identity",
  async () => {

    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-reference-vehicle-"
        )
      );


    try {

      const store =
        new ReferenceStore(
          directory
        );


      const frames =
        lapFrames(
          2,
          200_000,
          101,
          0,
          1
        ).map(
          (frame, index) =>
            index === 50
              ? {
                  ...frame,
                  vehicle:
                    "Other Vehicle"
                }
              : frame
        );


      await assert.rejects(
        () =>
          store.import({
            name: "Mixed vehicle reference",
            track: "Fuji Speedway",
            vehicle: "LMGT3",
            frames
          }),
        /vehicle/i
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
  "reference import rejects a selected lap with mixed track identity",
  async () => {

    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-reference-track-"
        )
      );


    try {

      const store =
        new ReferenceStore(
          directory
        );


      const frames =
        lapFrames(
          2,
          300_000,
          101,
          0,
          1
        ).map(
          (frame, index) =>
            index === 50
              ? {
                  ...frame,
                  track:
                    "Other Track"
                }
              : frame
        );


      await assert.rejects(
        () =>
          store.import({
            name: "Mixed track reference",
            track: "Fuji Speedway",
            vehicle: "LMGT3",
            frames
          }),
        /track/i
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
  "reference import stores only the coherent complete lap",
  async () => {

    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-reference-complete-"
        )
      );


    try {

      const store =
        new ReferenceStore(
          directory
        );


      const frames = [
        ...lapFrames(
          1,
          400_000,
          30,
          0.20,
          0.50
        ),

        ...lapFrames(
          2,
          410_000,
          101,
          0,
          1
        ),

        ...lapFrames(
          3,
          430_000,
          30,
          0.30,
          0.60
        )
      ];


      await store.import({
        name: "Coherent reference",
        track: "Fuji Speedway",
        vehicle: "LMGT3",
        frames
      });


      const stored =
        await store.matching(
          "Fuji Speedway",
          "LMGT3"
        );


      assert.ok(
        stored
      );


      assert.equal(
        stored.frames.length,
        101
      );


      assert.equal(
        new Set(
          stored.frames.map(
            frame => frame.lap
          )
        ).size,
        1
      );


      assert.equal(
        stored.frames[0]!.lap,
        2
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
  "session recorder persists vehicle changes as separate sessions",
  async () => {

    const directory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-session-vehicle-"
        )
      );


    try {

      const recorder =
        new SessionRecorder(
          directory
        );


      await recorder.initialize();


      for (
        let index = 0;
        index < 25;
        index++
      ) {

        const timestamp =
          500_000 +
          index * 100;


        await recorder.recordFrame({
          ...simulatedFrame(
            timestamp
          ),

          timestamp,

          track:
            "Fuji Speedway",

          vehicle:
            "LMGT3",

          session:
            "practice",

          lap: 1,

          lapDistance:
            index / 100
        });
      }


      for (
        let index = 0;
        index < 25;
        index++
      ) {

        const timestamp =
          502_500 +
          index * 100;


        await recorder.recordFrame({
          ...simulatedFrame(
            timestamp
          ),

          timestamp,

          track:
            "Fuji Speedway",

          vehicle:
            "Hypercar",

          session:
            "practice",

          lap: 1,

          lapDistance:
            index / 100
        });
      }


      await recorder.finish();


      const summaries =
        await recorder.list();


      assert.equal(
        summaries.length,
        2
      );


      assert.deepEqual(
        new Set(
          summaries.map(
            summary =>
              summary.vehicle
          )
        ),
        new Set([
          "LMGT3",
          "Hypercar"
        ])
      );


      for (
        const summary of summaries
      ) {

        const session =
          await recorder.get(
            summary.id
          );


        assert.ok(
          session
        );


        assert.equal(
          session.frames.every(
            frame =>
              frame.vehicle ===
              summary.vehicle
          ),
          true
        );
      }
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