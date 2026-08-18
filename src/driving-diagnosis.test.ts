import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPedalFindings
} from "./driving-diagnosis.js";

import type {
  PedalShapeAssessment,
  PedalTimingAssessment
} from "./pedal-diagnosis.js";


test(
  "keeps brake timing and brake shape as separate deterministic findings",
  () => {

    const timing: PedalTimingAssessment = {
      state: "reference",

      referenceSource: "expert",
      referenceLabel: "Expert reference",

      brakeRelease: {
        status: "earlier",
        actualLapDistance: 0.18,
        referenceLapDistance: 0.22,
        deltaMeters: -20,
        measurementResolutionMeters: 5
      },

      throttlePickup: {
        status: "unavailable"
      }
    };


    const shape: PedalShapeAssessment = {
      brakeRelease: {
        status: "abrupt",
        peakRatePerSecond: 6,
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


    const findings =
      buildPedalFindings(
        timing,
        shape
      );


    assert.deepEqual(
      findings.map(
        finding => ({
          skill: finding.skill,
          concept: finding.concept,
          status: finding.status,
          provenance: finding.provenance
        })
      ),

      [
        {
          skill: "braking",
          concept: "release-timing",
          status: "earlier",
          provenance: "trusted-reference"
        },

        {
          skill: "braking",
          concept: "release-shape",
          status: "abrupt",
          provenance: "telemetry"
        }
      ]
    );
  }
);

test(
  "keeps throttle timing and throttle shape as separate deterministic findings",
  () => {

    const timing: PedalTimingAssessment = {
      state: "reference",

      referenceSource: "expert",
      referenceLabel: "Expert reference",

      brakeRelease: {
        status: "unavailable"
      },

      throttlePickup: {
        status: "later",
        actualLapDistance: 0.28,
        referenceLapDistance: 0.24,
        deltaMeters: 20,
        measurementResolutionMeters: 5
      }
    };


    const shape: PedalShapeAssessment = {
      brakeRelease: {
        status: "unavailable",
        peakRatePerSecond: 0,
        reapplications: 0,
        loadedSamples: 0
      },

      throttleApplication: {
        status: "corrective",
        peakRatePerSecond: 2,
        corrections: 1,
        loadedSamples: 4
      }
    };


    const findings =
      buildPedalFindings(
        timing,
        shape
      );


    assert.deepEqual(
      findings.map(
        finding => ({
          skill: finding.skill,
          concept: finding.concept,
          status: finding.status,
          provenance: finding.provenance
        })
      ),

      [
        {
          skill: "throttle",
          concept: "pickup-timing",
          status: "later",
          provenance: "trusted-reference"
        },

        {
          skill: "throttle",
          concept: "application-shape",
          status: "corrective",
          provenance: "telemetry"
        }
      ]
    );
  }
);

test(
  "retains measured evidence and source provenance without turning it into coaching advice",
  () => {

    const timing: PedalTimingAssessment = {
      state: "reference",

      referenceSource: "expert",
      referenceLabel: "Expert reference",

      brakeRelease: {
        status: "earlier",
        actualLapDistance: 0.18,
        referenceLapDistance: 0.22,
        deltaMeters: -20,
        measurementResolutionMeters: 5
      },

      throttlePickup: {
        status: "unavailable"
      }
    };


    const shape: PedalShapeAssessment = {
      brakeRelease: {
        status: "abrupt",
        peakRatePerSecond: 6,
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


    const findings =
      buildPedalFindings(
        timing,
        shape
      );


    const timingFinding =
      findings.find(
        finding =>
          finding.concept ===
          "release-timing"
      );


    const shapeFinding =
      findings.find(
        finding =>
          finding.concept ===
          "release-shape"
      );


    assert.ok(timingFinding);
    assert.ok(shapeFinding);


    assert.equal(
      timingFinding.referenceSource,
      "expert"
    );

    assert.equal(
      timingFinding.referenceLabel,
      "Expert reference"
    );

    assert.deepEqual(
      timingFinding.evidence,
      {
        actualLapDistance: 0.18,
        referenceLapDistance: 0.22,
        deltaMeters: -20,
        measurementResolutionMeters: 5
      }
    );


    assert.deepEqual(
      shapeFinding.evidence,
      {
        peakRatePerSecond: 6,
        eventCount: 0,
        sampleCount: 4
      }
    );


    assert.equal(
      "message" in timingFinding,
      false
    );

    assert.equal(
      "instruction" in timingFinding,
      false
    );
  }
);

test(
  "actual-only timing emits no trusted-reference findings while preserving telemetry findings",
  () => {

    const timing: PedalTimingAssessment = {
      state: "actual-only",

      brakeRelease: {
        status: "unavailable"
      },

      throttlePickup: {
        status: "unavailable"
      }
    };


    const shape: PedalShapeAssessment = {
      brakeRelease: {
        status: "abrupt",
        peakRatePerSecond: 6,
        reapplications: 0,
        loadedSamples: 4
      },

      throttleApplication: {
        status: "corrective",
        peakRatePerSecond: 2,
        corrections: 1,
        loadedSamples: 4
      }
    };


    const findings =
      buildPedalFindings(
        timing,
        shape
      );


    assert.equal(
      findings.some(
        finding =>
          finding.provenance ===
          "trusted-reference"
      ),
      false
    );


    assert.deepEqual(
      findings.map(
        finding =>
          finding.concept
      ),

      [
        "release-shape",
        "application-shape"
      ]
    );
  }
);

test(
  "retains matched and progressive evidence as positive execution findings",
  () => {

    const timing: PedalTimingAssessment = {
      state: "reference",

      referenceSource: "personal-best",
      referenceLabel: "Personal best",

      brakeRelease: {
        status: "matched",
        actualLapDistance: 0.22,
        referenceLapDistance: 0.22,
        deltaMeters: 0,
        measurementResolutionMeters: 5
      },

      throttlePickup: {
        status: "matched",
        actualLapDistance: 0.24,
        referenceLapDistance: 0.24,
        deltaMeters: 0,
        measurementResolutionMeters: 5
      }
    };


    const shape: PedalShapeAssessment = {
      brakeRelease: {
        status: "progressive",
        peakRatePerSecond: 1.5,
        reapplications: 0,
        loadedSamples: 5
      },

      throttleApplication: {
        status: "progressive",
        peakRatePerSecond: 1,
        corrections: 0,
        loadedSamples: 5
      }
    };


    const findings =
      buildPedalFindings(
        timing,
        shape
      );


    assert.deepEqual(
      findings.map(
        finding => ({
          concept: finding.concept,
          status: finding.status,
          provenance: finding.provenance
        })
      ),

      [
        {
          concept: "release-timing",
          status: "matched",
          provenance: "trusted-reference"
        },

        {
          concept: "release-shape",
          status: "progressive",
          provenance: "telemetry"
        },

        {
          concept: "pickup-timing",
          status: "matched",
          provenance: "trusted-reference"
        },

        {
          concept: "application-shape",
          status: "progressive",
          provenance: "telemetry"
        }
      ]
    );
  }
);
