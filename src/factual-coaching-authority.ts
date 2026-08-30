import type {
  CompletedCornerDiagnosis
} from "./corner-diagnosis-authority.js";

import type {
  DrivingFinding
} from "./driving-diagnosis.js";


export interface FactualCoachingDecision {
  diagnosis: CompletedCornerDiagnosis;
  finding: DrivingFinding;
}


export class FactualCoachingAuthority {
  decisions(
    diagnosis: CompletedCornerDiagnosis | null
  ): readonly FactualCoachingDecision[] {
    if (
      diagnosis === null
    ) {
      return [];
    }

    return diagnosis.diagnosis.findings.map(
      finding => ({
        diagnosis,
        finding
      })
    );
  }
}
