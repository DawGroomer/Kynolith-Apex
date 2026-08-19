import type {
  DrivingReference,
  RecordedSession,
  TelemetryFrame
} from "./types.js";

import type {
  PedalReferenceInput
} from "./pedal-graph.js";


const MINIMUM_REFERENCE_FRAMES = 20;


export interface PedalReferenceSelectionInput {
  track: string;
  vehicle: string;

  sessions: RecordedSession[];

  expert?: DrivingReference | null;
}


export function selectPedalReference(
  input: PedalReferenceSelectionInput
): PedalReferenceInput | null {
  const expert =
    selectExpertReference(
      input.track,
      input.vehicle,
      input.expert ?? null
    );


  if (expert) {
    return expert;
  }


  return selectTrustedPersonalBest(
    input.track,
    input.vehicle,
    input.sessions
  );
}


function selectExpertReference(
  track: string,
  vehicle: string,
  expert: DrivingReference | null
): PedalReferenceInput | null {
  if (!expert) {
    return null;
  }


  if (
    expert.track !== track ||
    expert.vehicle !== vehicle
  ) {
    return null;
  }


  if (
    !Array.isArray(expert.frames) ||
    expert.frames.length <
      MINIMUM_REFERENCE_FRAMES
  ) {
    return null;
  }


  const referenceLap =
    expert.frames[0]!.lap;


  if (
    !Number.isFinite(
      referenceLap
    ) ||
    expert.frames.some(
      frame =>
        frame.track !== track ||
        frame.vehicle !== vehicle ||
        frame.lap !== referenceLap
    )
  ) {
    return null;
  }


  const source =
    expert.benchmark?.type ===
    "mylmu-community-benchmark"
      ? "community-benchmark"
      : "expert";


  return {
    source,
    label: expert.name,
    track,
    vehicle,
    frames: expert.frames.slice()
  };
}


function selectTrustedPersonalBest(
  track: string,
  vehicle: string,
  sessions: RecordedSession[]
): PedalReferenceInput | null {
  let best:
    | {
        seconds: number;
        frames: TelemetryFrame[];
      }
    | null = null;


  for (const session of sessions) {
    if (
      session.summary.track !== track ||
      session.summary.vehicle !== vehicle
    ) {
      continue;
    }


    for (const lap of session.summary.laps) {
      if (
        !lap.complete ||
        lap.durationSeconds <= 20 ||
        lap.quality?.status !== "trusted"
      ) {
        continue;
      }


      if (
        best &&
        lap.durationSeconds >=
          best.seconds
      ) {
        continue;
      }


      const frames =
        session.frames.filter(
          frame =>
            frame.lap === lap.lap
        );


      if (
        frames.length <
        MINIMUM_REFERENCE_FRAMES
      ) {
        continue;
      }


      if (
        frames.some(
          frame =>
            frame.track !== track ||
            frame.vehicle !== vehicle
        )
      ) {
        continue;
      }


      best = {
        seconds:
          lap.durationSeconds,

        frames:
          frames.slice()
      };
    }
  }


  if (!best) {
    return null;
  }


  return {
    source: "personal-best",

    label:
      `Personal best ${formatLap(
        best.seconds
      )}`,

    track,
    vehicle,

    frames:
      best.frames
  };
}


function formatLap(
  seconds: number
): string {
  const minutes =
    Math.floor(
      seconds / 60
    );


  return (
    `${minutes}:` +
    (
      seconds -
      minutes * 60
    )
      .toFixed(3)
      .padStart(
        6,
        "0"
      )
  );
}