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

  if (
    !hasSingleActualOwnership(
      actualWindow
    )
  ) {
    return diagnosePedalWindow(
      [],
      referenceWindow
    );
  }

  const ownedReference =
    hasSingleReferenceOwnership(
      referenceWindow
    )
      ? referenceWindow
      : {
          ...referenceWindow,
          frames: []
        };

  return diagnosePedalWindow(
    actualWindow,
    ownedReference
  );
}


function hasSingleActualOwnership(
  frames: TelemetryFrame[]
): boolean {
  const first =
    frames[0];

  if (!first) {
    return false;
  }

  return frames.every(
    frame =>
      frame.track === first.track &&
      frame.vehicle === first.vehicle &&
      frame.session === first.session &&
      frame.lap === first.lap
  );
}


function hasSingleReferenceOwnership(
  reference: PedalReferenceInput
): boolean {
  const first =
    reference.frames[0];

  if (
    !first ||
    !Number.isFinite(
      first.lap
    )
  ) {
    return false;
  }

  return reference.frames.every(
    frame =>
      frame.track === reference.track &&
      frame.vehicle === reference.vehicle &&
      frame.lap === first.lap
  );
}
