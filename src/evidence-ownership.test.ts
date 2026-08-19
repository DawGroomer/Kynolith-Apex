import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldSplitSession
} from "./data-quality.js";

import {
  diagnosePedalCorner
} from "./pedal-window-diagnosis.js";

import {
  selectPedalReference
} from "./pedal-reference.js";

import {
  simulatedFrame
} from "./simulator.js";

import type {
  DrivingReference,
  TelemetryFrame
} from "./types.js";

import type {
  PedalReferenceInput
} from "./pedal-graph.js";


const corner = {
  id: "fuji-t1",
  name: "Turn 1",
  entry: 0.14,
  apex: 0.18,
  exit: 0.24
};


function trace(
  lap: number,
  timestampBase: number,
  overrides: Partial<TelemetryFrame> = {}
): TelemetryFrame[] {

  return Array.from(
    { length: 21 },
    (_, index) => {

      const lapDistance =
        0.10 +
        index * 0.01;

      const timestamp =
        timestampBase +
        index * 100;

      return {
        ...simulatedFrame(timestamp),

        timestamp,

        session: "practice",
        track: "Fuji Speedway",
        vehicle: "LMGT3",

        lap,
        lapDistance,

        trackLengthMeters: 5_000,

        speedKph: 120,

        brake:
          lapDistance < 0.20
            ? 0.70
            : 0,

        throttle:
          lapDistance >= 0.22
            ? 0.70
            : 0,

        steering: 0.25,

        ...overrides
      };
    }
  );
}


function pedalReference(
  frames: TelemetryFrame[]
): PedalReferenceInput {

  return {
    source: "expert",
    label: "Expert reference",

    track: "Fuji Speedway",
    vehicle: "LMGT3",

    frames
  };
}


function expertReference(
  frames: TelemetryFrame[]
): DrivingReference {

  return {
    id: "reference-expert",
    name: "Expert reference",

    track: "Fuji Speedway",
    vehicle: "LMGT3",

    importedAt: 1,
    lapTimeSeconds: 90,

    frames
  };
}


test(
  "session ownership splits when telemetry identity changes",
  () => {

    const previous = {
      ...simulatedFrame(10_000),

      timestamp: 10_000,

      track: "Fuji Speedway",
      vehicle: "LMGT3",
      session: "practice" as const,

      lap: 2,
      lapDistance: 0.40
    };


    assert.match(
      shouldSplitSession(
        previous,
        {
          ...previous,
          timestamp: 10_100,
          vehicle: "Hypercar"
        }
      ) ?? "",
      /vehicle/i
    );


    assert.match(
      shouldSplitSession(
        previous,
        {
          ...previous,
          timestamp: 10_100,
          track: "Circuit de la Sarthe"
        }
      ) ?? "",
      /track/i
    );


    assert.match(
      shouldSplitSession(
        previous,
        {
          ...previous,
          timestamp: 10_100,
          session: "qualifying"
        }
      ) ?? "",
      /session/i
    );
  }
);


test(
  "actual corner evidence fails closed when track identity is mixed",
  () => {

    const actual =
      trace(
        3,
        30_000
      ).map(
        (frame, index) =>
          index < 10
            ? frame
            : {
                ...frame,
                track: "Other Track"
              }
      );


    const result =
      diagnosePedalCorner(
        actual,

        pedalReference(
          trace(
            1,
            10_000
          )
        ),

        corner
      );


    assert.equal(
      result.timing.state,
      "actual-only"
    );

    assert.equal(
      result.shape.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.shape.throttleApplication.status,
      "unavailable"
    );

    assert.deepEqual(
      result.findings,
      []
    );
  }
);


test(
  "actual corner evidence fails closed when vehicle identity is mixed",
  () => {

    const actual =
      trace(
        3,
        30_000
      ).map(
        (frame, index) =>
          index < 10
            ? frame
            : {
                ...frame,
                vehicle: "Other Vehicle"
              }
      );


    const result =
      diagnosePedalCorner(
        actual,

        pedalReference(
          trace(
            1,
            10_000
          )
        ),

        corner
      );


    assert.equal(
      result.timing.state,
      "actual-only"
    );

    assert.equal(
      result.shape.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.shape.throttleApplication.status,
      "unavailable"
    );

    assert.deepEqual(
      result.findings,
      []
    );
  }
);


test(
  "actual corner evidence fails closed when session identity is mixed",
  () => {

    const actual =
      trace(
        3,
        30_000
      ).map(
        (frame, index) =>
          index < 10
            ? frame
            : {
                ...frame,
                session: "qualifying" as const
              }
      );


    const result =
      diagnosePedalCorner(
        actual,

        pedalReference(
          trace(
            1,
            10_000
          )
        ),

        corner
      );


    assert.equal(
      result.timing.state,
      "actual-only"
    );

    assert.equal(
      result.shape.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.shape.throttleApplication.status,
      "unavailable"
    );

    assert.deepEqual(
      result.findings,
      []
    );
  }
);


test(
  "multi-lap reference loses reference authority while valid actual telemetry remains usable",
  () => {

    const actual =
      trace(
        3,
        30_000
      );


    const referenceFrames = [
      ...trace(
        1,
        10_000
      ),

      ...trace(
        2,
        20_000
      )
    ];


    const result =
      diagnosePedalCorner(
        actual,

        pedalReference(
          referenceFrames
        ),

        corner
      );


    assert.equal(
      result.timing.state,
      "actual-only"
    );


    assert.equal(
      result.findings.some(
        finding =>
          finding.provenance ===
          "trusted-reference"
      ),
      false
    );


    assert.equal(
      result.findings.some(
        finding =>
          finding.provenance ===
          "telemetry"
      ),
      true
    );
  }
);


test(
  "expert pedal reference must contain one coherent lap",
  () => {

    const expert =
      expertReference(
        [
          ...trace(
            1,
            10_000
          ),

          ...trace(
            2,
            20_000
          )
        ]
      );


    const selected =
      selectPedalReference({
        track: "Fuji Speedway",
        vehicle: "LMGT3",

        sessions: [],

        expert
      });


    assert.equal(
      selected,
      null
    );
  }
);