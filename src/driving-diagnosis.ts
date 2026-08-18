import type {
  PedalShapeAssessment,
  PedalTimingAssessment
} from "./pedal-diagnosis.js";

export type DrivingFindingSkill =
  | "braking"
  | "throttle";

export type DrivingFindingConcept =
  | "release-timing"
  | "release-shape"
  | "pickup-timing"
  | "application-shape";

export type DrivingFindingProvenance =
  | "trusted-reference"
  | "telemetry";

export interface DrivingFindingEvidence {
  actualLapDistance?: number;
  referenceLapDistance?: number;
  deltaMeters?: number;
  measurementResolutionMeters?: number;
  peakRatePerSecond?: number;
  eventCount?: number;
  sampleCount?: number;
}

export interface DrivingFinding {
  skill: DrivingFindingSkill;
  concept: DrivingFindingConcept;
  status: string;
  provenance: DrivingFindingProvenance;
  referenceSource?: PedalTimingAssessment["referenceSource"];
  referenceLabel?: string;
  evidence: DrivingFindingEvidence;
}

export function buildPedalFindings(
  timing: PedalTimingAssessment,
  shape: PedalShapeAssessment
): DrivingFinding[] {
  const findings: DrivingFinding[] = [];

  if (
    timing.state === "reference" &&
    timing.brakeRelease.status !== "unavailable"
  ) {
    findings.push({
      skill: "braking",
      concept: "release-timing",
      status: timing.brakeRelease.status,
      provenance: "trusted-reference",
      ...(timing.referenceSource !== undefined
        ? { referenceSource: timing.referenceSource }
        : {}),
      ...(timing.referenceLabel !== undefined
        ? { referenceLabel: timing.referenceLabel }
        : {}),
      evidence: {
        actualLapDistance:
          timing.brakeRelease.actualLapDistance,
        referenceLapDistance:
          timing.brakeRelease.referenceLapDistance,
        deltaMeters:
          timing.brakeRelease.deltaMeters,
        measurementResolutionMeters:
          timing.brakeRelease.measurementResolutionMeters
      }
    });
  }

  if (
    shape.brakeRelease.status !== "unavailable"
  ) {
    findings.push({
      skill: "braking",
      concept: "release-shape",
      status: shape.brakeRelease.status,
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond:
          shape.brakeRelease.peakRatePerSecond,
        eventCount:
          shape.brakeRelease.reapplications,
        sampleCount:
          shape.brakeRelease.loadedSamples
      }
    });
  }

  if (
    timing.state === "reference" &&
    timing.throttlePickup.status !== "unavailable"
  ) {
    findings.push({
      skill: "throttle",
      concept: "pickup-timing",
      status: timing.throttlePickup.status,
      provenance: "trusted-reference",
      ...(timing.referenceSource !== undefined
        ? { referenceSource: timing.referenceSource }
        : {}),
      ...(timing.referenceLabel !== undefined
        ? { referenceLabel: timing.referenceLabel }
        : {}),
      evidence: {
        actualLapDistance:
          timing.throttlePickup.actualLapDistance,
        referenceLapDistance:
          timing.throttlePickup.referenceLapDistance,
        deltaMeters:
          timing.throttlePickup.deltaMeters,
        measurementResolutionMeters:
          timing.throttlePickup.measurementResolutionMeters
      }
    });
  }

  if (
    shape.throttleApplication.status !== "unavailable"
  ) {
    findings.push({
      skill: "throttle",
      concept: "application-shape",
      status: shape.throttleApplication.status,
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond:
          shape.throttleApplication.peakRatePerSecond,
        eventCount:
          shape.throttleApplication.corrections,
        sampleCount:
          shape.throttleApplication.loadedSamples
      }
    });
  }

  return findings;
}
