import assert from "node:assert/strict";
import test from "node:test";

import { simulatedFrame } from "./simulator.js";

import {
  assessPedalShape,
  assessPedalTiming
} from "./pedal-diagnosis.js";

import {
  buildPedalFindings
} from "./driving-diagnosis.js";

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
  "orchestrates one bounded pedal window through C1 C2 and C3 authorities",
  async () => {
    const modulePath =
      "./pedal-window-diagnosis.js";

    const loaded =
      await import(modulePath)
        .catch(
          () => (
            {} as Record<string, unknown>
          )
        );

    const diagnosePedalWindow =
      (
        loaded as {
          diagnosePedalWindow?: (
            actualFrames: TelemetryFrame[],
            referenceInput: PedalReferenceInput
          ) => unknown;
        }
      ).diagnosePedalWindow;

    assert.equal(
      typeof diagnosePedalWindow,
      "function"
    );

    if (
      typeof diagnosePedalWindow !==
      "function"
    ) {
      return;
    }

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

    const timing =
      assessPedalTiming(
        actual,
        benchmark
      );

    const shape =
      assessPedalShape(
        actual
      );

    const findings =
      buildPedalFindings(
        timing,
        shape
      );

    assert.deepEqual(
      diagnosePedalWindow(
        actual,
        benchmark
      ),
      {
        timing,
        shape,
        findings
      }
    );
  }
);

test(
  "uses TrackCorner entry and exit as the authority for one diagnosis window",
  async () => {
    const loaded =
      await import(
        "./pedal-window-diagnosis.js"
      );

    const diagnosePedalCorner =
      (
        loaded as {
          diagnosePedalCorner?: (
            actualFrames: TelemetryFrame[],
            referenceInput: PedalReferenceInput,
            corner: {
              id: string;
              name: string;
              entry: number;
              apex: number;
              exit: number;
            }
          ) => unknown;
        }
      ).diagnosePedalCorner;

    assert.equal(
      typeof diagnosePedalCorner,
      "function"
    );

    if (
      typeof diagnosePedalCorner !==
      "function"
    ) {
      return;
    }

    const corner = {
      id: "fuji-t1",
      name: "Turn 1",
      entry: 0.14,
      apex: 0.18,
      exit: 0.24
    };

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

    const actualWindow =
      actual.filter(
        frame =>
          frame.lapDistance >= corner.entry &&
          frame.lapDistance <= corner.exit
      );

    const referenceWindow = {
      ...benchmark,
      frames:
        benchmark.frames.filter(
          frame =>
            frame.lapDistance >= corner.entry &&
            frame.lapDistance <= corner.exit
        )
    };

    const timing =
      assessPedalTiming(
        actualWindow,
        referenceWindow
      );

    const shape =
      assessPedalShape(
        actualWindow
      );

    const findings =
      buildPedalFindings(
        timing,
        shape
      );

    assert.deepEqual(
      diagnosePedalCorner(
        actual,
        benchmark,
        corner
      ),
      {
        timing,
        shape,
        findings
      }
    );
  }
);

test(
  "fails closed instead of combining the same corner across multiple actual laps",
  async () => {
    const {
      diagnosePedalCorner
    } = await import(
      "./pedal-window-diagnosis.js"
    );

    const corner = {
      id: "fuji-t1",
      name: "Turn 1",
      entry: 0.14,
      apex: 0.18,
      exit: 0.24
    };

    const lapTwo =
      trace(
        0.18,
        0.22,
        20_000
      );

    const lapThree =
      trace(
        0.22,
        0.20,
        30_000
      ).map(
        frame => ({
          ...frame,
          lap: 3
        })
      );

    const benchmark =
      reference(
        trace(
          0.22,
          0.20,
          10_000
        )
      );

    const result =
      diagnosePedalCorner(
        [
          ...lapTwo,
          ...lapThree
        ],
        benchmark,
        corner
      );

    assert.equal(
      result.timing.state,
      "actual-only"
    );

    assert.equal(
      result.timing.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.timing.throttlePickup.status,
      "unavailable"
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
  "preserves intrinsic telemetry findings when no trusted reference exists",
  async () => {
    const {
      diagnosePedalCorner
    } = await import(
      "./pedal-window-diagnosis.js"
    );

    const corner = {
      id: "fuji-t1",
      name: "Turn 1",
      entry: 0.14,
      apex: 0.18,
      exit: 0.24
    };

    const actual =
      trace(
        0.18,
        0.28,
        20_000
      );

    const before =
      JSON.stringify(
        actual
      );

    const result =
      diagnosePedalCorner(
        actual,
        null,
        corner
      );

    assert.equal(
      result.timing.state,
      "actual-only"
    );

    assert.equal(
      result.timing.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.timing.throttlePickup.status,
      "unavailable"
    );

    assert.notEqual(
      result.shape.brakeRelease.status,
      "unavailable"
    );

    assert.equal(
      result.findings.some(
        finding =>
          finding.provenance ===
          "telemetry"
      ),
      true
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
      JSON.stringify(
        actual
      ),
      before
    );
  }
);
