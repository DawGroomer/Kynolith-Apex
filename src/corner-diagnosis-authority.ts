import {
  diagnosePedalCorner
} from "./pedal-window-diagnosis.js";

import type {
  PedalWindowDiagnosis
} from "./pedal-window-diagnosis.js";

import type {
  PedalReferenceInput
} from "./pedal-graph.js";

import type {
  SessionType,
  TelemetryFrame,
  TrackCorner,
  TrackModel
} from "./types.js";


export interface CompletedCornerDiagnosis {
  track: string;
  vehicle: string;
  session: SessionType;
  lap: number;

  corner: TrackCorner;

  completedAt: number;

  diagnosis: PedalWindowDiagnosis;
}


export interface CornerDiagnosisConfiguration {
  model: TrackModel;
  reference: PedalReferenceInput | null;
}


interface ActiveCornerWindow {
  corner: TrackCorner;
  frames: TelemetryFrame[];
}


export class CornerDiagnosisAuthority {
  private configuration:
    CornerDiagnosisConfiguration | null = null;

  private readonly active =
    new Map<string, ActiveCornerWindow>();

  private readonly completedIdentities =
    new Set<string>();

  private previousFrame:
    TelemetryFrame | null = null;


  configure(
    configuration: CornerDiagnosisConfiguration
  ): void {
    this.configuration =
      configuration;

    this.active.clear();
    this.completedIdentities.clear();
    this.previousFrame = null;
  }


  ingest(
    frame: TelemetryFrame
  ): CompletedCornerDiagnosis[] {
    const configuration =
      this.configuration;

    if (!configuration) {
      return [];
    }


    const completed:
      CompletedCornerDiagnosis[] = [];


    for (
      const [cornerId, active]
      of this.active
    ) {
      const first =
        active.frames[0];

      const completesAtLapBoundary =
        first &&
        first.track ===
          frame.track &&
        first.vehicle ===
          frame.vehicle &&
        first.session ===
          frame.session &&
        active.corner.exit ===
          1 &&
        frame.lap ===
          first.lap + 1 &&
        frame.lapDistance <
          active.corner.entry &&
        active.frames.some(
          evidence =>
            evidence.lapDistance >
            active.corner.apex
        );

      if (completesAtLapBoundary) {
        this.active.delete(
          cornerId
        );

        this.completedIdentities.add(
          completionIdentity(
            first,
            active.corner
          )
        );

        completed.push({
          track: first.track,
          vehicle: first.vehicle,
          session: first.session,
          lap: first.lap,

          corner: active.corner,

          completedAt:
            frame.timestamp,

          diagnosis:
            diagnosePedalCorner(
              active.frames,
              configuration.reference,
              active.corner
            )
        });

        continue;
      }

      if (
        first &&
        !sameEvidenceOwner(
          first,
          frame
        )
      ) {
        this.active.delete(
          cornerId
        );
      }
    }


    for (
      const [cornerId, active]
      of this.active
    ) {
      if (
        frame.lapDistance >
          active.corner.exit
      ) {
        this.active.delete(
          cornerId
        );

        const first =
          active.frames[0];

        if (!first) {
          continue;
        }

        this.completedIdentities.add(
          completionIdentity(
            first,
            active.corner
          )
        );

        completed.push({
          track: first.track,
          vehicle: first.vehicle,
          session: first.session,
          lap: first.lap,

          corner: active.corner,

          completedAt:
            frame.timestamp,

          diagnosis:
            diagnosePedalCorner(
              active.frames,
              configuration.reference,
              active.corner
            )
        });

        continue;
      }


      if (
        frame.lapDistance >=
          active.corner.entry &&
        frame.lapDistance <=
          active.corner.exit
      ) {
        active.frames.push(
          frame
        );
      }
    }


    for (
      const corner of
      configuration.model.corners
    ) {
      if (
        this.active.has(
          corner.id
        )
      ) {
        continue;
      }

      if (
        this.completedIdentities.has(
          completionIdentity(
            frame,
            corner
          )
        )
      ) {
        continue;
      }

      const previous =
        this.previousFrame;

      const entryZeroLapTransition =
        corner.entry ===
          0 &&
        previous !== null &&
        previous.track ===
          frame.track &&
        previous.vehicle ===
          frame.vehicle &&
        previous.session ===
          frame.session &&
        frame.lap ===
          previous.lap + 1 &&
        frame.lapDistance <
          previous.lapDistance &&
        frame.lapDistance <=
          corner.apex;

      if (entryZeroLapTransition) {
        this.active.set(
          corner.id,
          {
            corner,
            frames: [frame]
          }
        );

        continue;
      }

      if (
        !previous ||
        !sameEvidenceOwner(
          previous,
          frame
        ) ||
        previous.lapDistance >=
          corner.entry ||
        frame.lapDistance <
          corner.entry ||
        frame.lapDistance >
          corner.exit
      ) {
        continue;
      }

      this.active.set(
        corner.id,
        {
          corner,
          frames: [frame]
        }
      );
    }


    this.previousFrame =
      frame;

    return completed;
  }


  reset(): void {
    this.active.clear();
    this.completedIdentities.clear();
    this.previousFrame = null;
  }
}

function sameEvidenceOwner(
  left: TelemetryFrame,
  right: TelemetryFrame
): boolean {
  return (
    left.track ===
      right.track &&
    left.vehicle ===
      right.vehicle &&
    left.session ===
      right.session &&
    left.lap ===
      right.lap
  );
}

function completionIdentity(
  frame: TelemetryFrame,
  corner: TrackCorner
): string {
  return JSON.stringify(
    [
      frame.track,
      frame.vehicle,
      frame.session,
      frame.lap,
      corner.id
    ]
  );
}
