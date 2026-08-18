import assert from "node:assert/strict";
import test from "node:test";

import { simulatedFrame } from "./simulator.js";

import {
  assessPedalTiming
} from "./pedal-diagnosis.js";

import type {
  PedalReferenceInput
} from "./pedal-graph.js";

import type {
  TelemetryFrame
} from "./types.js";


function trace(
  brakeReleaseEnd: number,
  throttlePickupStart: number,
  timestampBase: number
): TelemetryFrame[] {
  return Array.from(
    { length: 21 },
    (_, index) => {
      const lapDistance =
        0.10 + index * 0.01;

      let brake = 0;

      if (lapDistance < brakeReleaseEnd - 0.04) {
        brake = 0.8;
      }
      else if (lapDistance < brakeReleaseEnd) {
        brake =
          Math.max(
            0,
            (
              brakeReleaseEnd -
              lapDistance
            ) / 0.04 * 0.8
          );
      }

      let throttle = 0;

      if (lapDistance >= throttlePickupStart) {
        throttle =
          Math.min(
            1,
            (
              lapDistance -
              throttlePickupStart
            ) / 0.05
          );
      }

      return {
        ...simulatedFrame(
          timestampBase +
          index * 100
        ),

        track: "Fuji Speedway",
        vehicle: "LMGT3",
        lap: 2,
        lapDistance,

        brake,
        throttle,

        steering:
          lapDistance >= 0.14 &&
          lapDistance <= 0.24
            ? 0.25
            : 0.05,

        speedKph: 120,

        trackLengthMeters: 5_000
      };
    }
  );
}


function reference(
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


test(
  "classifies earlier brake release and later throttle pickup relative to the trusted reference",
  () => {
    const actual =
      trace(
        0.18,
        0.28,
        20_000
      );

    const benchmark =
      reference(
        trace(
          0.22,
          0.24,
          10_000
        )
      );

    const result =
      assessPedalTiming(
        actual,
        benchmark
      );

    assert.equal(
      result.state,
      "reference"
    );

    assert.equal(
      result.brakeRelease.status,
      "earlier"
    );

    assert.equal(
      result.throttlePickup.status,
      "later"
    );

    assert.ok(
      typeof result.brakeRelease.deltaMeters ===
        "number"
    );

    assert.ok(
      typeof result.throttlePickup.deltaMeters ===
        "number"
    );
  }
);


test(
  "matching pedal timing remains matched instead of inventing a correction",
  () => {
    const benchmarkFrames =
      trace(
        0.22,
        0.24,
        10_000
      );

    const actual =
      trace(
        0.22,
        0.24,
        20_000
      );

    const result =
      assessPedalTiming(
        actual,
        reference(
          benchmarkFrames
        )
      );

    assert.equal(
      result.brakeRelease.status,
      "matched"
    );

    assert.equal(
      result.throttlePickup.status,
      "matched"
    );
  }
);


test(
  "mismatched reference identity fails closed to actual-only",
  () => {
    const actual =
      trace(
        0.18,
        0.28,
        20_000
      );

    const benchmark = {
      ...reference(
        trace(
          0.22,
          0.24,
          10_000
        )
      ),

      track:
        "Circuit de la Sarthe"
    };

    const result =
      assessPedalTiming(
        actual,
        benchmark
      );

    assert.equal(
      result.state,
      "actual-only"
    );

    assert.equal(
      result.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.throttlePickup.status,
      "unavailable"
    );
  }
);


test(
  "pedal timing assessment does not mutate telemetry or reference evidence",
  () => {
    const actual =
      trace(
        0.18,
        0.28,
        20_000
      );

    const benchmark =
      reference(
        trace(
          0.22,
          0.24,
          10_000
        )
      );

    const actualBefore =
      JSON.stringify(actual);

    const benchmarkBefore =
      JSON.stringify(benchmark);

    assessPedalTiming(
      actual,
      benchmark
    );

    assert.equal(
      JSON.stringify(actual),
      actualBefore
    );

    assert.equal(
      JSON.stringify(benchmark),
      benchmarkBefore
    );
  }
);