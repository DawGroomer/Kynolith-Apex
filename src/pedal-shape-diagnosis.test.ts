import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPedalShape
} from "./pedal-diagnosis.js";

import {
  simulatedFrame
} from "./simulator.js";

import type {
  TelemetryFrame
} from "./types.js";


function frame(
  offsetMs: number,
  brake: number,
  throttle: number,
  steering = 0.25
): TelemetryFrame {

  const timestamp =
    100_000 + offsetMs;

  return {
    ...simulatedFrame(timestamp),

    timestamp,

    track: "Fuji Speedway",
    vehicle: "LMGT3",
    lap: 2,

    lapDistance:
      0.20 +
      offsetMs / 100_000,

    speedKph: 110,

    brake,
    throttle,
    steering
  };
}


test(
  "classifies smooth loaded brake release and throttle squeeze as progressive",
  () => {

    const frames = [
      frame(0,   0.80, 0.00),
      frame(100, 0.65, 0.00),
      frame(200, 0.50, 0.00),
      frame(300, 0.35, 0.10),
      frame(400, 0.20, 0.20),
      frame(500, 0.08, 0.30),
      frame(600, 0.00, 0.40, 0.20),
      frame(700, 0.00, 0.50, 0.15),
      frame(800, 0.00, 0.60, 0.10)
    ];


    const result =
      assessPedalShape(frames);


    assert.equal(
      result.brakeRelease.status,
      "progressive"
    );


    assert.equal(
      result.throttleApplication.status,
      "progressive"
    );


    assert.ok(
      result.brakeRelease.peakRatePerSecond <=
        2.2
    );


    assert.ok(
      result.throttleApplication.peakRatePerSecond <=
        2.5
    );
  }
);


test(
  "classifies excessive loaded brake release and throttle application rates as abrupt",
  () => {

    const frames = [
      frame(0,   0.80, 0.00),
      frame(100, 0.70, 0.00),
      frame(200, 0.10, 0.10),
      frame(300, 0.00, 0.65),
      frame(400, 0.00, 0.75)
    ];


    const result =
      assessPedalShape(frames);


    assert.equal(
      result.brakeRelease.status,
      "abrupt"
    );


    assert.ok(
      result.brakeRelease.peakRatePerSecond >
        2.2
    );


    assert.equal(
      result.throttleApplication.status,
      "abrupt"
    );


    assert.ok(
      result.throttleApplication.peakRatePerSecond >
        2.5
    );
  }
);


test(
  "brake reapplication is classified separately from ordinary release rate",
  () => {

    const frames = [
      frame(0,   0.70, 0.00),
      frame(100, 0.55, 0.00),
      frame(200, 0.40, 0.15),
      frame(300, 0.52, 0.30),
      frame(400, 0.35, 0.40),
      frame(500, 0.20, 0.50),
      frame(600, 0.08, 0.60),
      frame(700, 0.00, 0.70)
    ];


    const result =
      assessPedalShape(frames);


    assert.equal(
      result.brakeRelease.status,
      "reapplied"
    );


    assert.equal(
      result.brakeRelease.reapplications,
      1
    );
  }
);


test(
  "secondary throttle lift after committed pickup is classified as corrective",
  () => {

    const frames = [
      frame(0,   0.60, 0.00),
      frame(100, 0.45, 0.00),
      frame(200, 0.30, 0.15),
      frame(300, 0.15, 0.30),
      frame(400, 0.05, 0.50),
      frame(500, 0.00, 0.28),
      frame(600, 0.00, 0.45),
      frame(700, 0.00, 0.60)
    ];


    const result =
      assessPedalShape(frames);


    assert.equal(
      result.throttleApplication.status,
      "corrective"
    );


    assert.equal(
      result.throttleApplication.corrections,
      1
    );
  }
);


test(
  "insufficient loaded pedal evidence fails closed",
  () => {

    const frames = [
      frame(
        0,
        0,
        0,
        0
      ),

      frame(
        100,
        0,
        0,
        0
      )
    ];


    const result =
      assessPedalShape(frames);


    assert.equal(
      result.brakeRelease.status,
      "unavailable"
    );


    assert.equal(
      result.throttleApplication.status,
      "unavailable"
    );
  }
);


test(
  "pedal shape assessment does not mutate telemetry evidence",
  () => {

    const frames = [
      frame(0,   0.70, 0.00),
      frame(100, 0.55, 0.00),
      frame(200, 0.40, 0.15),
      frame(300, 0.25, 0.30),
      frame(400, 0.10, 0.45),
      frame(500, 0.00, 0.60)
    ];


    const before =
      JSON.stringify(frames);


    assessPedalShape(frames);


    assert.equal(
      JSON.stringify(frames),
      before
    );
  }
);