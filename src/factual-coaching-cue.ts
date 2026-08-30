import type {
  FactualCoachingClaim
} from "./factual-coaching-claim.js";

import type {
  CoachingCue
} from "./types.js";


export function cueForClaim(
  claim: FactualCoachingClaim,
  at: number
): CoachingCue {
  const finding =
    claim.decision.finding;
  const diagnosis =
    claim.decision.diagnosis;
  const category =
    finding.skill === "braking"
      ? "braking"
      : "throttle";
  const identity = [
    "factual",
    diagnosis.track,
    diagnosis.vehicle,
    diagnosis.session,
    diagnosis.lap,
    diagnosis.corner.id,
    diagnosis.completedAt,
    at,
    finding.skill,
    finding.concept,
    finding.status,
    finding.provenance
  ]
    .map(
      value =>
        encodeURIComponent(
          String(value)
        )
    )
    .join("-");

  return {
    id: identity,
    at,
    priority: "technique",
    category,
    message: claim.message,
    speak: true,
    expiresAt: at + 3_500,
    delayInHardPart: true
  };
}
