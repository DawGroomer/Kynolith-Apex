import type {
  PedalReferenceInput,
  PedalReferenceSource
} from "./pedal-graph.js";

import type {
  TelemetryFrame
} from "./types.js";


const BRAKE_RELEASE_THRESHOLD = 0.06;
const THROTTLE_PICKUP_THRESHOLD = 0.08;


export type PedalTimingStatus =
  | "earlier"
  | "matched"
  | "later"
  | "unavailable";


export type PedalTimingFinding =
  | {
      status: "unavailable";
    }
  | {
      status:
        | "earlier"
        | "matched"
        | "later";

      actualLapDistance: number;
      referenceLapDistance: number;

      deltaMeters: number;
      measurementResolutionMeters: number;
    };


export interface PedalTimingAssessment {
  state:
    | "reference"
    | "actual-only";

  referenceSource?: PedalReferenceSource;
  referenceLabel?: string;

  brakeRelease: PedalTimingFinding;
  throttlePickup: PedalTimingFinding;
}


interface TraceIdentity {
  track: string;
  vehicle: string;
}


export function assessPedalTiming(
  actualFrames: TelemetryFrame[],
  reference: PedalReferenceInput
): PedalTimingAssessment {

  const unavailable =
    actualOnly();

  const identity =
    traceIdentity(actualFrames);

  if (!identity) {
    return unavailable;
  }


  if (
    reference.track !== identity.track ||
    reference.vehicle !== identity.vehicle
  ) {
    return unavailable;
  }


  if (
    !traceMatchesIdentity(
      reference.frames,
      identity
    )
  ) {
    return unavailable;
  }


  if (
    !validTrace(actualFrames) ||
    !validTrace(reference.frames)
  ) {
    return unavailable;
  }


  const actual =
    orderedTrace(actualFrames);

  const benchmark =
    orderedTrace(reference.frames);


  if (
    actual.length < 3 ||
    benchmark.length < 3
  ) {
    return unavailable;
  }


  const trackLengthMeters =
    representativeTrackLength(
      actual,
      benchmark
    );


  if (
    trackLengthMeters === null
  ) {
    return unavailable;
  }


  const actualResolution =
    spatialResolution(actual);

  const referenceResolution =
    spatialResolution(benchmark);


  if (
    actualResolution === null ||
    referenceResolution === null
  ) {
    return unavailable;
  }


  const measurementResolutionMeters =
    Math.max(
      actualResolution,
      referenceResolution
    ) * trackLengthMeters;


  const actualBrakeRelease =
    lastDownwardCrossing(
      actual,
      "brake",
      BRAKE_RELEASE_THRESHOLD
    );


  const referenceBrakeRelease =
    lastDownwardCrossing(
      benchmark,
      "brake",
      BRAKE_RELEASE_THRESHOLD
    );


  const actualThrottlePickup =
    firstUpwardCrossing(
      actual,
      "throttle",
      THROTTLE_PICKUP_THRESHOLD
    );


  const referenceThrottlePickup =
    firstUpwardCrossing(
      benchmark,
      "throttle",
      THROTTLE_PICKUP_THRESHOLD
    );


  return {
    state: "reference",

    referenceSource:
      reference.source,

    referenceLabel:
      reference.label,

    brakeRelease:
      compareTiming(
        actualBrakeRelease,
        referenceBrakeRelease,
        trackLengthMeters,
        measurementResolutionMeters
      ),

    throttlePickup:
      compareTiming(
        actualThrottlePickup,
        referenceThrottlePickup,
        trackLengthMeters,
        measurementResolutionMeters
      )
  };
}


function actualOnly(): PedalTimingAssessment {
  return {
    state: "actual-only",

    brakeRelease: {
      status: "unavailable"
    },

    throttlePickup: {
      status: "unavailable"
    }
  };
}


function traceIdentity(
  frames: TelemetryFrame[]
): TraceIdentity | null {

  const first =
    frames[0];

  if (
    !first ||
    !first.track ||
    !first.vehicle
  ) {
    return null;
  }


  const identity = {
    track: first.track,
    vehicle: first.vehicle
  };


  return traceMatchesIdentity(
    frames,
    identity
  )
    ? identity
    : null;
}


function traceMatchesIdentity(
  frames: TelemetryFrame[],
  identity: TraceIdentity
): boolean {

  return (
    frames.length > 0 &&
    frames.every(
      frame =>
        frame.track === identity.track &&
        frame.vehicle === identity.vehicle
    )
  );
}


function validTrace(
  frames: TelemetryFrame[]
): boolean {

  return frames.every(
    frame =>
      Number.isFinite(
        frame.lapDistance
      ) &&
      frame.lapDistance >= 0 &&
      frame.lapDistance <= 1 &&

      Number.isFinite(
        frame.brake
      ) &&
      frame.brake >= 0 &&
      frame.brake <= 1 &&

      Number.isFinite(
        frame.throttle
      ) &&
      frame.throttle >= 0 &&
      frame.throttle <= 1
  );
}


function orderedTrace(
  frames: TelemetryFrame[]
): TelemetryFrame[] {

  return frames
    .slice()
    .sort(
      (a, b) =>
        a.lapDistance -
        b.lapDistance
    );
}


function representativeTrackLength(
  actual: TelemetryFrame[],
  reference: TelemetryFrame[]
): number | null {

  const values =
    [...actual, ...reference]
      .map(
        frame =>
          frame.trackLengthMeters
      )
      .filter(
        (value): value is number =>
          Number.isFinite(value) &&
          Number(value) > 0
      )
      .sort(
        (a, b) =>
          a - b
      );


  if (!values.length) {
    return null;
  }


  return values[
    Math.floor(
      values.length / 2
    )
  ]!;
}


function spatialResolution(
  frames: TelemetryFrame[]
): number | null {

  const intervals: number[] =
    [];


  for (
    let index = 1;
    index < frames.length;
    index++
  ) {

    const previous =
      frames[index - 1]!;

    const current =
      frames[index]!;


    const difference =
      current.lapDistance -
      previous.lapDistance;


    if (
      Number.isFinite(difference) &&
      difference > 0
    ) {
      intervals.push(
        difference
      );
    }
  }


  if (!intervals.length) {
    return null;
  }


  intervals.sort(
    (a, b) =>
      a - b
  );


  return intervals[
    Math.floor(
      intervals.length / 2
    )
  ]!;
}


function lastDownwardCrossing(
  frames: TelemetryFrame[],
  key: "brake" | "throttle",
  threshold: number
): number | null {

  let crossing:
    number | null =
    null;


  for (
    let index = 1;
    index < frames.length;
    index++
  ) {

    const previous =
      frames[index - 1]!;

    const current =
      frames[index]!;


    if (
      previous[key] > threshold &&
      current[key] <= threshold
    ) {
      crossing =
        interpolateCrossing(
          previous,
          current,
          key,
          threshold
        );
    }
  }


  return crossing;
}


function firstUpwardCrossing(
  frames: TelemetryFrame[],
  key: "brake" | "throttle",
  threshold: number
): number | null {

  for (
    let index = 1;
    index < frames.length;
    index++
  ) {

    const previous =
      frames[index - 1]!;

    const current =
      frames[index]!;


    if (
      previous[key] <= threshold &&
      current[key] > threshold
    ) {
      return interpolateCrossing(
        previous,
        current,
        key,
        threshold
      );
    }
  }


  return null;
}


function interpolateCrossing(
  previous: TelemetryFrame,
  current: TelemetryFrame,
  key: "brake" | "throttle",
  threshold: number
): number {

  const change =
    current[key] -
    previous[key];


  if (
    change === 0
  ) {
    return current.lapDistance;
  }


  const ratio =
    Math.max(
      0,
      Math.min(
        1,
        (
          threshold -
          previous[key]
        ) /
        change
      )
    );


  return (
    previous.lapDistance +
    (
      current.lapDistance -
      previous.lapDistance
    ) *
    ratio
  );
}


function compareTiming(
  actual: number | null,
  reference: number | null,
  trackLengthMeters: number,
  measurementResolutionMeters: number
): PedalTimingFinding {

  if (
    actual === null ||
    reference === null
  ) {
    return {
      status: "unavailable"
    };
  }


  const deltaMeters =
    (
      actual -
      reference
    ) *
    trackLengthMeters;


  const status:
    Exclude<
      PedalTimingStatus,
      "unavailable"
    > =
      Math.abs(
        deltaMeters
      ) <=
      measurementResolutionMeters
        ? "matched"
        : deltaMeters < 0
          ? "earlier"
          : "later";


  return {
    status,

    actualLapDistance:
      actual,

    referenceLapDistance:
      reference,

    deltaMeters:
      Math.round(
        deltaMeters * 10
      ) / 10,

    measurementResolutionMeters:
      Math.round(
        measurementResolutionMeters *
        10
      ) / 10
  };
}

const BRAKE_RELEASE_RATE_LIMIT = 2.2;
const BRAKE_REAPPLICATION_DELTA = 0.08;

const THROTTLE_APPLICATION_RATE_LIMIT = 2.5;
const THROTTLE_COMMITTED_LEVEL = 0.4;
const THROTTLE_CORRECTION_DELTA = 0.18;


export type BrakeReleaseShapeStatus =
  | "progressive"
  | "abrupt"
  | "reapplied"
  | "unavailable";


export type ThrottleApplicationShapeStatus =
  | "progressive"
  | "abrupt"
  | "corrective"
  | "unavailable";


export interface BrakeReleaseShapeFinding {
  status: BrakeReleaseShapeStatus;
  peakRatePerSecond: number;
  reapplications: number;
  loadedSamples: number;
}


export interface ThrottleApplicationShapeFinding {
  status: ThrottleApplicationShapeStatus;
  peakRatePerSecond: number;
  corrections: number;
  loadedSamples: number;
}


export interface PedalShapeAssessment {
  brakeRelease: BrakeReleaseShapeFinding;
  throttleApplication: ThrottleApplicationShapeFinding;
}


export function assessPedalShape(
  sourceFrames: TelemetryFrame[]
): PedalShapeAssessment {

  const unavailable =
    unavailablePedalShape();


  if (
    sourceFrames.length < 3 ||
    !validShapeTrace(sourceFrames)
  ) {
    return unavailable;
  }


  const frames =
    sourceFrames
      .slice()
      .sort(
        (a, b) =>
          a.timestamp -
          b.timestamp
      );


  let brakeReleaseSamples = 0;
  let brakePeakRate = 0;
  let brakeReapplications = 0;

  let throttleApplicationSamples = 0;
  let throttlePeakRate = 0;
  let throttleCorrections = 0;


  for (
    let index = 1;
    index < frames.length;
    index++
  ) {

    const previous =
      frames[index - 1]!;

    const current =
      frames[index]!;


    const seconds =
      Math.max(
        0.001,
        Math.min(
          0.25,
          (
            current.timestamp -
            previous.timestamp
          ) /
          1000
        )
      );


    const brakeLoaded =
      previous.brake > 0.08 &&
      Math.abs(
        current.steering
      ) > 0.08;


    if (brakeLoaded) {

      if (
        current.brake <
        previous.brake
      ) {

        const releaseRate =
          (
            previous.brake -
            current.brake
          ) /
          seconds;


        brakeReleaseSamples++;


        brakePeakRate =
          Math.max(
            brakePeakRate,
            releaseRate
          );
      }


      if (
        current.brake >
        previous.brake +
        BRAKE_REAPPLICATION_DELTA
      ) {
        brakeReapplications++;
      }
    }


    const throttleLoaded =
      Math.abs(
        current.steering
      ) > 0.12;


    if (
      throttleLoaded &&
      current.throttle >
      previous.throttle
    ) {

      const applicationRate =
        (
          current.throttle -
          previous.throttle
        ) /
        seconds;


      throttleApplicationSamples++;


      throttlePeakRate =
        Math.max(
          throttlePeakRate,
          applicationRate
        );
    }


    if (
      previous.throttle >
        THROTTLE_COMMITTED_LEVEL &&
      current.throttle <
        previous.throttle -
        THROTTLE_CORRECTION_DELTA
    ) {
      throttleCorrections++;
    }
  }


  const brakeRelease:
    BrakeReleaseShapeFinding =
      brakeReleaseSamples === 0 &&
      brakeReapplications === 0
        ? {
            status: "unavailable",
            peakRatePerSecond: 0,
            reapplications: 0,
            loadedSamples: 0
          }
        : {
            status:
              brakeReapplications > 0
                ? "reapplied"
                : brakePeakRate >
                    BRAKE_RELEASE_RATE_LIMIT
                  ? "abrupt"
                  : "progressive",

            peakRatePerSecond:
              roundRate(
                brakePeakRate
              ),

            reapplications:
              brakeReapplications,

            loadedSamples:
              brakeReleaseSamples
          };


  const throttleApplication:
    ThrottleApplicationShapeFinding =
      throttleApplicationSamples === 0 &&
      throttleCorrections === 0
        ? {
            status: "unavailable",
            peakRatePerSecond: 0,
            corrections: 0,
            loadedSamples: 0
          }
        : {
            status:
              throttleCorrections > 0
                ? "corrective"
                : throttlePeakRate >
                    THROTTLE_APPLICATION_RATE_LIMIT
                  ? "abrupt"
                  : "progressive",

            peakRatePerSecond:
              roundRate(
                throttlePeakRate
              ),

            corrections:
              throttleCorrections,

            loadedSamples:
              throttleApplicationSamples
          };


  return {
    brakeRelease,
    throttleApplication
  };
}


function unavailablePedalShape():
  PedalShapeAssessment {

  return {
    brakeRelease: {
      status: "unavailable",
      peakRatePerSecond: 0,
      reapplications: 0,
      loadedSamples: 0
    },

    throttleApplication: {
      status: "unavailable",
      peakRatePerSecond: 0,
      corrections: 0,
      loadedSamples: 0
    }
  };
}


function validShapeTrace(
  frames: TelemetryFrame[]
): boolean {

  return frames.every(
    frame =>
      Number.isFinite(
        frame.timestamp
      ) &&

      Number.isFinite(
        frame.brake
      ) &&
      frame.brake >= 0 &&
      frame.brake <= 1 &&

      Number.isFinite(
        frame.throttle
      ) &&
      frame.throttle >= 0 &&
      frame.throttle <= 1 &&

      Number.isFinite(
        frame.steering
      )
  );
}


function roundRate(
  value: number
): number {

  return (
    Math.round(
      value * 1000
    ) /
    1000
  );
}
