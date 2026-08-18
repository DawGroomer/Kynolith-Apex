import {
  buildPedalFindings
} from "./driving-diagnosis.js";

import type {
  DrivingFinding
} from "./driving-diagnosis.js";

import {
  assessPedalShape,
  assessPedalTiming
} from "./pedal-diagnosis.js";

import type {
  PedalShapeAssessment,
  PedalTimingAssessment
} from "./pedal-diagnosis.js";

import type {
  PedalReferenceInput
} from "./pedal-graph.js";

import type {
  TelemetryFrame,
  TrackCorner
} from "./types.js";


export interface PedalWindowDiagnosis {
  timing: PedalTimingAssessment;
  shape: PedalShapeAssessment;
  findings: DrivingFinding[];
}


export function diagnosePedalWindow(
  actualFrames: TelemetryFrame[],
  reference: PedalReferenceInput
): PedalWindowDiagnosis {
  const timing =
    assessPedalTiming(
      actualFrames,
      reference
    );

  const shape =
    assessPedalShape(
      actualFrames
    );

  const findings =
    buildPedalFindings(
      timing,
      shape
    );

  return {
    timing,
    shape,
    findings
  };
}


export function diagnosePedalCorner(
  actualFrames: TelemetryFrame[],
  reference: PedalReferenceInput,
  corner: TrackCorner
): PedalWindowDiagnosis {
  const withinCorner = (
    frame: TelemetryFrame
  ): boolean =>
    frame.lapDistance >= corner.entry &&
    frame.lapDistance <= corner.exit;

  const actualWindow =
    actualFrames.filter(withinCorner);

  const referenceWindow: PedalReferenceInput = {
    ...reference,
    frames:
      reference.frames.filter(
        withinCorner
      )
  };

  const actualLaps =
    new Set(
      actualWindow.map(
        frame => frame.lap
      )
    );

  if (actualLaps.size !== 1) {
    return diagnosePedalWindow(
      [],
      referenceWindow
    );
  }

  return diagnosePedalWindow(
    actualWindow,
    referenceWindow
  );
}
