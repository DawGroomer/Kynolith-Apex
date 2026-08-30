import assert from "node:assert/strict";
import test from "node:test";

import type {
  CompletedCornerDiagnosis
} from "./corner-diagnosis-authority.js";

import type {
  DrivingFinding
} from "./driving-diagnosis.js";

import type {
  PedalShapeAssessment,
  PedalTimingAssessment
} from "./pedal-diagnosis.js";

import type {
  TrackCorner
} from "./types.js";

import {
  FactualCoachingAuthority
} from "./factual-coaching-authority.js";


const corner: TrackCorner = {
  id: "test-t1",
  name: "Test Turn 1",
  entry: 0.10,
  apex: 0.15,
  exit: 0.20
};


function actualOnlyTiming(): PedalTimingAssessment {
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


function shape(): PedalShapeAssessment {
  return {
    brakeRelease: {
      status: "progressive",
      peakRatePerSecond: 1.2,
      reapplications: 0,
      loadedSamples: 4
    },
    throttleApplication: {
      status: "unavailable",
      peakRatePerSecond: 0,
      corrections: 0,
      loadedSamples: 0
    }
  };
}


function diagnosis(
  finding: DrivingFinding
): CompletedCornerDiagnosis {
  return {
    track: "Test Track",
    vehicle: "Test Car",
    session: "practice",
    lap: 4,
    corner,
    completedAt: 42_000,
    diagnosis: {
      timing: actualOnlyTiming(),
      shape: shape(),
      findings: [finding]
    }
  };
}


test(
  "produces no factual coaching decision without a completed C5C diagnosis",
  () => {
    const authority =
      new FactualCoachingAuthority();

    assert.deepEqual(
      authority.decisions(null),
      []
    );
  }
);


test(
  "preserves an intrinsic C5C finding and its corner identity",
  () => {
    const finding: DrivingFinding = {
      skill: "braking",
      concept: "release-shape",
      status: "progressive",
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond: 1.2,
        eventCount: 0,
        sampleCount: 4
      }
    };

    const completed =
      diagnosis(
        finding
      );

    const decisions =
      new FactualCoachingAuthority().decisions(
        completed
      );
    const decision = decisions[0];

    assert.equal(
      decisions.length,
      1
    );
    assert.ok(decision);
    assert.equal(
      decision.diagnosis.track,
      completed.track
    );
    assert.equal(
      decision.diagnosis.vehicle,
      completed.vehicle
    );
    assert.equal(
      decision.diagnosis.session,
      completed.session
    );
    assert.equal(
      decision.diagnosis.lap,
      completed.lap
    );
    assert.equal(
      decision.diagnosis.corner.id,
      completed.corner.id
    );
    assert.equal(
      decision.diagnosis.corner.name,
      completed.corner.name
    );
    assert.deepEqual(
      decision.finding,
      finding
    );
    assert.equal(
      decision.finding.provenance,
      "telemetry"
    );
    assert.equal(
      decision.finding.referenceSource,
      undefined
    );
    assert.equal(
      decision.finding.referenceLabel,
      undefined
    );
    assert.equal(
      "message" in decision,
      false
    );
  }
);


test(
  "no-reference timing cannot create a reference-relative factual claim",
  () => {
    const finding: DrivingFinding = {
      skill: "throttle",
      concept: "application-shape",
      status: "progressive",
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond: 1.1,
        eventCount: 0,
        sampleCount: 5
      }
    };

    const completed =
      diagnosis(
        finding
      );

    assert.equal(
      completed.diagnosis.timing.state,
      "actual-only"
    );

    const decisions =
      new FactualCoachingAuthority().decisions(
        completed
      );
    const decision = decisions[0];

    assert.equal(
      decisions.length,
      1
    );
    assert.ok(decision);
    assert.equal(
      decision.finding.provenance,
      "telemetry"
    );
    assert.equal(
      decision.finding.referenceSource,
      undefined
    );
    assert.equal(
      decision.finding.referenceLabel,
      undefined
    );
    assert.equal(
      "message" in decision,
      false
    );
  }
);


test(
  "preserves trusted-reference provenance and comparison evidence",
  () => {
    const finding: DrivingFinding = {
      skill: "braking",
      concept: "release-timing",
      status: "earlier",
      provenance: "trusted-reference",
      referenceSource: "expert",
      referenceLabel: "Expert lap",
      evidence: {
        actualLapDistance: 0.14,
        referenceLapDistance: 0.12,
        deltaMeters: -10,
        measurementResolutionMeters: 2
      }
    };

    const decisions =
      new FactualCoachingAuthority().decisions(
        diagnosis(
          finding
        )
      );
    const decision = decisions[0];

    assert.equal(
      decisions.length,
      1
    );
    assert.ok(decision);
    assert.deepEqual(
      decision.finding,
      finding
    );
    assert.equal(
      decision.finding.provenance,
      "trusted-reference"
    );
    assert.equal(
      decision.finding.referenceSource,
      "expert"
    );
    assert.equal(
      decision.finding.referenceLabel,
      "Expert lap"
    );
    assert.equal(
      decision.finding.status,
      "earlier"
    );
    assert.equal(
      decision.finding.evidence.deltaMeters,
      -10
    );
  }
);


test(
  "produces one factual decision for each original C5C finding",
  () => {
    const intrinsicFinding: DrivingFinding = {
      skill: "braking",
      concept: "release-shape",
      status: "progressive",
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond: 1.2,
        eventCount: 0,
        sampleCount: 4
      }
    };

    const referenceFinding: DrivingFinding = {
      skill: "throttle",
      concept: "pickup-timing",
      status: "later",
      provenance: "trusted-reference",
      referenceSource: "expert",
      referenceLabel: "Expert lap",
      evidence: {
        actualLapDistance: 0.20,
        referenceLapDistance: 0.18,
        deltaMeters: 8,
        measurementResolutionMeters: 2
      }
    };

    const singleFindingDiagnosis =
      diagnosis(
        intrinsicFinding
      );

    const completed: CompletedCornerDiagnosis = {
      ...singleFindingDiagnosis,
      diagnosis: {
        ...singleFindingDiagnosis.diagnosis,
        findings: [
          intrinsicFinding,
          referenceFinding
        ]
      }
    };

    const decisions =
      new FactualCoachingAuthority().decisions(
        completed
      );

    assert.equal(
      decisions.length,
      2
    );
    assert.equal(
      new Set(
        decisions.map(
          decision => decision.finding
        )
      ).size,
      2
    );
    assert.ok(
      decisions.some(
        decision =>
          decision.diagnosis === completed &&
          decision.finding === intrinsicFinding
      )
    );
    assert.ok(
      decisions.some(
        decision =>
          decision.diagnosis === completed &&
          decision.finding === referenceFinding
      )
    );
  }
);
