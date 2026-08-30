import assert from "node:assert/strict";
import test from "node:test";

import type {
  CompletedCornerDiagnosis
} from "./corner-diagnosis-authority.js";

import type {
  FactualCoachingClaim
} from "./factual-coaching-claim.js";

import type {
  FactualCoachingDecision
} from "./factual-coaching-authority.js";

import {
  cueForClaim
} from "./factual-coaching-cue.js";

import type {
  DrivingFinding
} from "./driving-diagnosis.js";

import type {
  PedalShapeAssessment,
  PedalTimingAssessment
} from "./pedal-diagnosis.js";

import type {
  CoachingCue,
  TrackCorner
} from "./types.js";


const corner: TrackCorner = {
  id: "server-t1",
  name: "Server Turn 1",
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
      status: "abrupt",
      peakRatePerSecond: 6,
      reapplications: 0,
      loadedSamples: 1
    },
    throttleApplication: {
      status: "abrupt",
      peakRatePerSecond: 6,
      corrections: 0,
      loadedSamples: 1
    }
  };
}


function claimFor(
  finding: DrivingFinding,
  message: string
): FactualCoachingClaim {
  const diagnosis: CompletedCornerDiagnosis = {
    track: "Test Track",
    vehicle: "Test Car",
    session: "practice",
    lap: 2,
    corner,
    completedAt: 1_700,
    diagnosis: {
      timing: actualOnlyTiming(),
      shape: shape(),
      findings: [finding]
    }
  };

  const decision: FactualCoachingDecision = {
    diagnosis,
    finding
  };

  return {
    decision,
    message
  };
}


function brakeClaim(): FactualCoachingClaim {
  return claimFor(
    {
      skill: "braking",
      concept: "release-shape",
      status: "abrupt",
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond: 6,
        eventCount: 0,
        sampleCount: 1
      }
    },
    "Brake release was abrupt."
  );
}


function throttleClaim(): FactualCoachingClaim {
  return claimFor(
    {
      skill: "throttle",
      concept: "application-shape",
      status: "progressive",
      provenance: "telemetry",
      evidence: {
        peakRatePerSecond: 1.5,
        eventCount: 0,
        sampleCount: 2
      }
    },
    "Throttle application was progressive."
  );
}


test(
  "preserves the factual claim message exactly",
  () => {
    const claim = brakeClaim();
    const cue = cueForClaim(
      claim,
      1_700
    );

    assert.equal(
      cue.message,
      claim.message
    );
  }
);


test(
  "uses a deterministic event identity for the cue ID",
  () => {
    const claim = brakeClaim();
    const first = cueForClaim(
      claim,
      1_700
    );
    const second = cueForClaim(
      claim,
      1_700
    );
    const laterEvent = cueForClaim(
      claim,
      1_701
    );

    assert.equal(
      first.id,
      second.id
    );
    assert.notEqual(
      first.id,
      laterEvent.id
    );
  }
);


test(
  "uses the existing neutral technique cue transport defaults",
  () => {
    const cue: CoachingCue =
      cueForClaim(
        throttleClaim(),
        1_700
      );

    assert.equal(
      cue.at,
      1_700
    );
    assert.equal(
      cue.priority,
      "technique"
    );
    assert.equal(
      cue.category,
      "throttle"
    );
    assert.equal(
      cue.speak,
      true
    );
    assert.equal(
      cue.expiresAt,
      5_200
    );
    assert.equal(
      cue.delayInHardPart,
      true
    );
  }
);


test(
  "does not mutate the original factual claim",
  () => {
    const claim = brakeClaim();
    const before =
      JSON.stringify(
        claim
      );

    const cue = cueForClaim(
      claim,
      1_700
    );

    assert.equal(
      JSON.stringify(
        claim
      ),
      before
    );
    assert.strictEqual(
      cue.message,
      claim.message
    );
  }
);
