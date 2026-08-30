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
  claims
} from "./factual-coaching-claim.js";

import type {
  DrivingFinding
} from "./driving-diagnosis.js";

import type {
  PedalShapeAssessment,
  PedalTimingAssessment,
  PedalTimingFinding
} from "./pedal-diagnosis.js";

import type {
  TrackCorner
} from "./types.js";


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


function trustedTiming(
  skill: "braking" | "throttle",
  status: "earlier" | "matched" | "later"
): PedalTimingAssessment {
  const timingFinding: PedalTimingFinding = {
    status,
    actualLapDistance: 0.14,
    referenceLapDistance: 0.12,
    deltaMeters: -10,
    measurementResolutionMeters: 2
  };

  return {
    state: "reference",
    referenceSource: "expert",
    referenceLabel: "Expert lap",
    brakeRelease:
      skill === "braking"
        ? timingFinding
        : { status: "unavailable" },
    throttlePickup:
      skill === "throttle"
        ? timingFinding
        : { status: "unavailable" }
  };
}


function shape(): PedalShapeAssessment {
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


function decisionFor(
  finding: DrivingFinding,
  timing: PedalTimingAssessment = actualOnlyTiming()
): FactualCoachingDecision {
  const diagnosis: CompletedCornerDiagnosis = {
    track: "Test Track",
    vehicle: "Test Car",
    session: "practice",
    lap: 4,
    corner,
    completedAt: 42_000,
    diagnosis: {
      timing,
      shape: shape(),
      findings: [finding]
    }
  };

  return {
    diagnosis,
    finding
  };
}


function findingFor(
  overrides: Partial<DrivingFinding> = {}
): DrivingFinding {
  return {
    skill: "braking",
    concept: "release-shape",
    status: "abrupt",
    provenance: "telemetry",
    evidence: {
      peakRatePerSecond: 6,
      eventCount: 0,
      sampleCount: 1
    },
    ...overrides
  };
}


function assertClaim(
  decision: FactualCoachingDecision,
  message: string
): FactualCoachingClaim {
  const rendered =
    claims(
      [decision]
    );

  assert.equal(
    rendered.length,
    1
  );

  const claim = rendered[0];
  assert.ok(claim);
  assert.strictEqual(
    claim.decision,
    decision
  );
  assert.equal(
    claim.message,
    message
  );

  return claim;
}


function assertIntrinsicClaim(
  decision: FactualCoachingDecision,
  message: string
): void {
  const claim =
    assertClaim(
      decision,
      message
    );

  assert.doesNotMatch(
    claim.message,
    /reference|target|earlier|later|expert|personal best/i
  );
}


test(
  "renders every supported intrinsic brake-release shape status",
  () => {
    const cases = [
      [
        "progressive",
        "Brake release was progressive."
      ],
      [
        "abrupt",
        "Brake release was abrupt."
      ],
      [
        "reapplied",
        "Brake was reapplied during release."
      ]
    ] as const;

    for (
      const [status, message]
      of cases
    ) {
      assertIntrinsicClaim(
        decisionFor(
          findingFor({
            skill: "braking",
            concept: "release-shape",
            status,
            provenance: "telemetry"
          })
        ),
        message
      );
    }
  }
);


test(
  "renders every supported intrinsic throttle-application shape status",
  () => {
    const cases = [
      [
        "progressive",
        "Throttle application was progressive."
      ],
      [
        "abrupt",
        "Throttle application was abrupt."
      ],
      [
        "corrective",
        "Throttle application required correction."
      ]
    ] as const;

    for (
      const [status, message]
      of cases
    ) {
      assertIntrinsicClaim(
        decisionFor(
          findingFor({
            skill: "throttle",
            concept: "application-shape",
            status,
            provenance: "telemetry"
          })
        ),
        message
      );
    }
  }
);


test(
  "renders supported trusted-reference timing statuses without rebuilding evidence",
  () => {
    const cases = [
      [
        "braking",
        "earlier",
        "Brake release was earlier than the trusted reference."
      ],
      [
        "braking",
        "matched",
        "Brake release matched the trusted reference."
      ],
      [
        "braking",
        "later",
        "Brake release was later than the trusted reference."
      ],
      [
        "throttle",
        "earlier",
        "Throttle pickup was earlier than the trusted reference."
      ],
      [
        "throttle",
        "matched",
        "Throttle pickup matched the trusted reference."
      ],
      [
        "throttle",
        "later",
        "Throttle pickup was later than the trusted reference."
      ]
    ] as const;

    for (
      const [skill, status, message]
      of cases
    ) {
      const concept =
        skill === "braking"
          ? "release-timing"
          : "pickup-timing";
      const finding =
        findingFor({
          skill,
          concept,
          status,
          provenance: "trusted-reference",
          referenceSource: "expert",
          referenceLabel: "Expert lap",
          evidence: {
            actualLapDistance: 0.14,
            referenceLapDistance: 0.12,
            deltaMeters: -10,
            measurementResolutionMeters: 2
          }
        });
      const decision =
        decisionFor(
          finding,
          trustedTiming(
            skill,
            status
          )
        );
      const claim =
        assertClaim(
          decision,
          message
        );

      assert.strictEqual(
        claim.decision.finding,
        finding
      );
      assert.equal(
        claim.decision.finding.referenceSource,
        "expert"
      );
      assert.equal(
        claim.decision.finding.referenceLabel,
        "Expert lap"
      );
      assert.equal(
        claim.decision.finding.status,
        status
      );
      assert.equal(
        claim.decision.finding.evidence.deltaMeters,
        -10
      );
    }
  }
);


test(
  "omits unavailable and unknown statuses without throwing",
  () => {
    const decisions = [
      decisionFor(
        findingFor({
          status: "unavailable"
        })
      ),
      decisionFor(
        findingFor({
          status: "mystery-status"
        })
      ),
      decisionFor(
        findingFor({
          concept: "release-timing",
          status: "unavailable",
          provenance: "trusted-reference"
        })
      )
    ];

    assert.deepEqual(
      claims(
        decisions
      ),
      []
    );
  }
);


test(
  "omits unsupported provenance and concept combinations",
  () => {
    const decisions = [
      decisionFor(
        findingFor({
          concept: "release-timing",
          status: "earlier",
          provenance: "telemetry"
        })
      ),
      decisionFor(
        findingFor({
          concept: "release-shape",
          status: "abrupt",
          provenance: "trusted-reference"
        })
      ),
      decisionFor(
        findingFor({
          concept: "application-shape",
          status: "later",
          provenance: "telemetry"
        })
      )
    ];

    assert.deepEqual(
      claims(
        decisions
      ),
      []
    );
  }
);
