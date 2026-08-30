import type {
  FactualCoachingDecision
} from "./factual-coaching-authority.js";

import type {
  DrivingFinding
} from "./driving-diagnosis.js";


export interface FactualCoachingClaim {
  decision: FactualCoachingDecision;
  message: string;
}


export function claims(
  decisions: readonly FactualCoachingDecision[]
): readonly FactualCoachingClaim[] {
  const rendered: FactualCoachingClaim[] = [];

  for (
    const decision
    of decisions
  ) {
    const message =
      messageFor(
        decision.finding
      );

    if (
      message !== null
    ) {
      rendered.push({
        decision,
        message
      });
    }
  }

  return rendered;
}


function messageFor(
  finding: DrivingFinding
): string | null {
  if (
    finding.provenance ===
      "telemetry" &&
    finding.skill ===
      "braking" &&
    finding.concept ===
      "release-shape"
  ) {
    switch (
      finding.status
    ) {
      case "progressive":
        return "Brake release was progressive.";
      case "abrupt":
        return "Brake release was abrupt.";
      case "reapplied":
        return "Brake was reapplied during release.";
      default:
        return null;
    }
  }

  if (
    finding.provenance ===
      "telemetry" &&
    finding.skill ===
      "throttle" &&
    finding.concept ===
      "application-shape"
  ) {
    switch (
      finding.status
    ) {
      case "progressive":
        return "Throttle application was progressive.";
      case "abrupt":
        return "Throttle application was abrupt.";
      case "corrective":
        return "Throttle application required correction.";
      default:
        return null;
    }
  }

  if (
    finding.provenance ===
      "trusted-reference" &&
    finding.skill ===
      "braking" &&
    finding.concept ===
      "release-timing"
  ) {
    switch (
      finding.status
    ) {
      case "earlier":
        return "Brake release was earlier than the trusted reference.";
      case "matched":
        return "Brake release matched the trusted reference.";
      case "later":
        return "Brake release was later than the trusted reference.";
      default:
        return null;
    }
  }

  if (
    finding.provenance ===
      "trusted-reference" &&
    finding.skill ===
      "throttle" &&
    finding.concept ===
      "pickup-timing"
  ) {
    switch (
      finding.status
    ) {
      case "earlier":
        return "Throttle pickup was earlier than the trusted reference.";
      case "matched":
        return "Throttle pickup matched the trusted reference.";
      case "later":
        return "Throttle pickup was later than the trusted reference.";
      default:
        return null;
    }
  }

  return null;
}
