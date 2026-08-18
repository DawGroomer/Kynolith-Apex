import type {
  SessionType,
  TelemetryFrame
} from "./types.js";


const ACTUAL_HISTORY_MS = 2_500;
const REFERENCE_PAST_MS = 2_500;
const REFERENCE_FUTURE_MS = 1_500;


export type PedalReferenceSource =
  | "expert"
  | "community-benchmark"
  | "personal-best";


export interface PedalReferenceInput {
  source: PedalReferenceSource;
  label: string;

  track: string;
  vehicle: string;

  frames: TelemetryFrame[];
}


export interface PedalGraphPoint {
  offsetMs: number;

  brake: number;
  throttle: number;
}


export interface PedalGraphSnapshot {
  state:
    | "reference"
    | "actual-only";

  referenceSource?: PedalReferenceSource;
  referenceLabel?: string;

  actual: PedalGraphPoint[];
  reference: PedalGraphPoint[];
}


interface LivePedalSample {
  timestamp: number;

  brake: number;
  throttle: number;
}


interface LiveIdentity {
  track: string;
  vehicle: string;
  session: SessionType;
}


interface CurrentFrame {
  timestamp: number;

  track: string;
  vehicle: string;
  session: SessionType;

  lapDistance: number;

  brake: number;
  throttle: number;
}


interface ReferenceSample {
  timestamp: number;
  lapDistance: number;

  brake: number;
  throttle: number;
}


interface ReferenceNow {
  timestamp: number;

  brake: number;
  throttle: number;
}


interface StoredReference {
  source: PedalReferenceSource;
  label: string;

  track: string;
  vehicle: string;

  frames: ReferenceSample[];
}


export class PedalGraphModel {
  private actual: LivePedalSample[] = [];

  private identity: LiveIdentity | null = null;

  private current: CurrentFrame | null = null;

  private reference: StoredReference | null = null;


  ingest(frame: TelemetryFrame): void {
    const nextIdentity: LiveIdentity = {
      track: frame.track,
      vehicle: frame.vehicle,
      session: frame.session
    };


    if (
      this.identity &&
      !sameIdentity(
        this.identity,
        nextIdentity
      )
    ) {
      this.actual = [];
      this.current = null;
    }


    this.identity = nextIdentity;


    this.current = {
      timestamp: frame.timestamp,

      track: frame.track,
      vehicle: frame.vehicle,
      session: frame.session,

      lapDistance: frame.lapDistance,

      brake: frame.brake,
      throttle: frame.throttle
    };


    this.actual.push({
      timestamp: frame.timestamp,

      brake: frame.brake,
      throttle: frame.throttle
    });


    const cutoff =
      frame.timestamp -
      ACTUAL_HISTORY_MS;


    while (
      this.actual[0] &&
      this.actual[0].timestamp < cutoff
    ) {
      this.actual.shift();
    }
  }


  setReference(
    reference: PedalReferenceInput
  ): void {
    this.reference = {
      source: reference.source,
      label: reference.label,

      track: reference.track,
      vehicle: reference.vehicle,

      frames: reference.frames.map(
        frame => ({
          timestamp: frame.timestamp,
          lapDistance: frame.lapDistance,

          brake: frame.brake,
          throttle: frame.throttle
        })
      )
    };
  }


  reset(): void {
    this.actual = [];
    this.identity = null;
    this.current = null;
    this.reference = null;
  }


  snapshot(): PedalGraphSnapshot {
    const actual =
      this.actualSnapshot();


    const reference =
      this.referenceSnapshot();


    if (!reference) {
      return {
        state: "actual-only",

        actual,
        reference: []
      };
    }


    return {
      state: "reference",

      referenceSource:
        reference.source,

      referenceLabel:
        reference.label,

      actual,

      reference:
        reference.points
    };
  }


  private actualSnapshot():
    PedalGraphPoint[] {
    const now =
      this.current?.timestamp;


    if (now === undefined) {
      return [];
    }


    return this.actual
      .slice()
      .sort(
        (a, b) =>
          a.timestamp -
          b.timestamp
      )
      .map(
        sample => ({
          offsetMs:
            sample.timestamp -
            now,

          brake:
            sample.brake,

          throttle:
            sample.throttle
        })
      );
  }


  private referenceSnapshot(): {
    source: PedalReferenceSource;
    label: string;
    points: PedalGraphPoint[];
  } | null {
    const current =
      this.current;


    const reference =
      this.reference;


    if (
      !current ||
      !reference
    ) {
      return null;
    }


    if (
      reference.track !==
        current.track ||
      reference.vehicle !==
        current.vehicle
    ) {
      return null;
    }


    const ordered =
      validateReference(
        reference.frames
      );


    if (!ordered) {
      return null;
    }


    const now =
      interpolateReference(
        ordered,
        current.lapDistance
      );


    if (!now) {
      return null;
    }


    const points =
      ordered
        .map(
          frame => ({
            offsetMs:
              frame.timestamp -
              now.timestamp,

            brake:
              frame.brake,

            throttle:
              frame.throttle
          })
        )
        .filter(
          point =>
            point.offsetMs >=
              -REFERENCE_PAST_MS &&
            point.offsetMs <=
              REFERENCE_FUTURE_MS
        );


    const zeroIndex =
      points.findIndex(
        point =>
          Math.abs(
            point.offsetMs
          ) < 1e-9
      );


    const zeroPoint:
      PedalGraphPoint = {
        offsetMs: 0,

        brake:
          now.brake,

        throttle:
          now.throttle
      };


    if (zeroIndex >= 0) {
      points[zeroIndex] =
        zeroPoint;
    }
    else {
      points.push(
        zeroPoint
      );
    }


    points.sort(
      (a, b) =>
        a.offsetMs -
        b.offsetMs
    );


    return {
      source:
        reference.source,

      label:
        reference.label,

      points
    };
  }
}


function sameIdentity(
  left: LiveIdentity,
  right: LiveIdentity
): boolean {
  return (
    left.track ===
      right.track &&
    left.vehicle ===
      right.vehicle &&
    left.session ===
      right.session
  );
}


function validateReference(
  frames: ReferenceSample[]
): ReferenceSample[] | null {
  if (frames.length < 2) {
    return null;
  }


  for (const frame of frames) {
    if (
      !Number.isFinite(
        frame.timestamp
      ) ||
      !Number.isFinite(
        frame.lapDistance
      ) ||
      !Number.isFinite(
        frame.brake
      ) ||
      !Number.isFinite(
        frame.throttle
      )
    ) {
      return null;
    }


    if (
      frame.lapDistance < 0 ||
      frame.lapDistance > 1 ||
      frame.brake < 0 ||
      frame.brake > 1 ||
      frame.throttle < 0 ||
      frame.throttle > 1
    ) {
      return null;
    }
  }


  const ordered =
    frames
      .map(
        frame => ({
          ...frame
        })
      )
      .sort(
        (a, b) =>
          a.lapDistance -
            b.lapDistance ||
          a.timestamp -
            b.timestamp
      );


  if (
    ordered[0]!.lapDistance >=
    ordered.at(-1)!.lapDistance
  ) {
    return null;
  }


  return ordered;
}


function interpolateReference(
  frames: ReferenceSample[],
  lapDistance: number
): ReferenceNow | null {
  if (
    !Number.isFinite(
      lapDistance
    ) ||
    lapDistance < 0 ||
    lapDistance > 1
  ) {
    return null;
  }


  const first =
    frames[0]!;

  const last =
    frames.at(-1)!;


  if (
    lapDistance <
      first.lapDistance ||
    lapDistance >
      last.lapDistance
  ) {
    return null;
  }


  for (
    let index = 0;
    index < frames.length;
    index++
  ) {
    const exact =
      frames[index]!;


    if (
      Math.abs(
        exact.lapDistance -
        lapDistance
      ) < 1e-12
    ) {
      return {
        timestamp:
          exact.timestamp,

        brake:
          exact.brake,

        throttle:
          exact.throttle
      };
    }
  }


  for (
    let index = 1;
    index < frames.length;
    index++
  ) {
    const previous =
      frames[index - 1]!;

    const next =
      frames[index]!;


    if (
      previous.lapDistance >
        lapDistance ||
      next.lapDistance <
        lapDistance ||
      next.lapDistance <=
        previous.lapDistance
    ) {
      continue;
    }


    const ratio =
      (
        lapDistance -
        previous.lapDistance
      ) /
      (
        next.lapDistance -
        previous.lapDistance
      );


    return {
      timestamp:
        previous.timestamp +
        (
          next.timestamp -
          previous.timestamp
        ) *
        ratio,

      brake:
        previous.brake +
        (
          next.brake -
          previous.brake
        ) *
        ratio,

      throttle:
        previous.throttle +
        (
          next.throttle -
          previous.throttle
        ) *
        ratio
    };
  }


  return null;
}