import assert from "node:assert/strict";
import test from "node:test";

import {
  simulatedFrame
} from "./simulator.js";

import type {
  TelemetryFrame,
  TrackModel
} from "./types.js";


interface CompletedResult {
  track: string;
  vehicle: string;
  session: TelemetryFrame["session"];
  lap: number;

  corner: {
    id: string;
    name: string;
    entry: number;
    apex: number;
    exit: number;
  };

  completedAt: number;
  diagnosis: unknown;
}


interface AuthorityLike {
  configure(
    configuration: {
      model: TrackModel;
      reference: null;
    }
  ): void;

  ingest(
    frame: TelemetryFrame
  ): CompletedResult[];

  reset(): void;
}


function frame(
  lapDistance: number,
  timestamp: number,
  overrides: Partial<TelemetryFrame> = {}
): TelemetryFrame {
  return {
    ...simulatedFrame(
      timestamp
    ),

    track: "Test Track",
    vehicle: "Test Car",
    session: "practice",
    lap: 2,
    lapDistance,

    brake:
      lapDistance <= 0.14
        ? 0.8
        : 0.2,

    throttle:
      lapDistance >= 0.16
        ? 0.6
        : 0,

    steering:
      lapDistance >= 0.10 &&
      lapDistance <= 0.20
        ? 0.25
        : 0.02,

    ...overrides
  };
}


const model: TrackModel = {
  track: "Test Track",
  version: 1,
  source: "learned",

  corners: [
    {
      id: "test-t1",
      name: "Test Turn 1",
      entry: 0.10,
      apex: 0.15,
      exit: 0.20
    }
  ]
};


test(
  "emits one diagnosis only after a bounded corner completes",
  async () => {
    const loaded =
      await import(
        "./corner-diagnosis-authority.js"
      ).catch(
        () => (
          {} as Record<string, unknown>
        )
      );

    const CornerDiagnosisAuthority =
      (
        loaded as {
          CornerDiagnosisAuthority?:
            new () => AuthorityLike;
        }
      ).CornerDiagnosisAuthority;

    assert.equal(
      typeof CornerDiagnosisAuthority,
      "function"
    );

    if (
      typeof CornerDiagnosisAuthority !==
      "function"
    ) {
      return;
    }

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference: null
    });

    assert.deepEqual(
      authority.ingest(
        frame(
          0.09,
          1_000
        )
      ),
      []
    );

    const inside = [
      [0.10, 1_100],
      [0.12, 1_200],
      [0.14, 1_300],
      [0.16, 1_400],
      [0.18, 1_500],
      [0.20, 1_600]
    ] as const;

    for (const [distance, timestamp] of inside) {
      assert.deepEqual(
        authority.ingest(
          frame(
            distance,
            timestamp
          )
        ),
        []
      );
    }

    const completed =
      authority.ingest(
        frame(
          0.21,
          1_700
        )
      );

    assert.equal(
      completed.length,
      1
    );

    const result =
      completed[0]!;

    assert.equal(
      result.track,
      "Test Track"
    );

    assert.equal(
      result.vehicle,
      "Test Car"
    );

    assert.equal(
      result.session,
      "practice"
    );

    assert.equal(
      result.lap,
      2
    );

    assert.equal(
      result.corner.id,
      "test-t1"
    );

    assert.equal(
      result.completedAt,
      1_700
    );

    assert.deepEqual(
      authority.ingest(
        frame(
          0.22,
          1_800
        )
      ),
      []
    );
  }
);

test(
  "allows the same corner to diagnose again on the next lap",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference: null
    });

    const lapTwoFrames = [
      [0.09, 2_000],
      [0.10, 2_100],
      [0.12, 2_200],
      [0.14, 2_300],
      [0.16, 2_400],
      [0.18, 2_500],
      [0.20, 2_600]
    ] as const;

    for (
      const [distance, timestamp]
      of lapTwoFrames
    ) {
      authority.ingest(
        frame(
          distance,
          timestamp,
          {
            lap: 2
          }
        )
      );
    }

    const lapTwo =
      authority.ingest(
        frame(
          0.21,
          2_700,
          {
            lap: 2
          }
        )
      );

    assert.equal(
      lapTwo.length,
      1
    );

    assert.equal(
      lapTwo[0]!.lap,
      2
    );

    const lapThreeFrames = [
      [0.09, 3_000],
      [0.10, 3_100],
      [0.12, 3_200],
      [0.14, 3_300],
      [0.16, 3_400],
      [0.18, 3_500],
      [0.20, 3_600]
    ] as const;

    for (
      const [distance, timestamp]
      of lapThreeFrames
    ) {
      authority.ingest(
        frame(
          distance,
          timestamp,
          {
            lap: 3
          }
        )
      );
    }

    const lapThree =
      authority.ingest(
        frame(
          0.21,
          3_700,
          {
            lap: 3
          }
        )
      );

    assert.equal(
      lapThree.length,
      1
    );

    assert.equal(
      lapThree[0]!.lap,
      3
    );
  }
);

test(
  "discards incomplete corner evidence when telemetry ownership changes",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const transitions: Array<{
      name: string;
      overrides: Partial<TelemetryFrame>;
    }> = [
      {
        name: "track",
        overrides: {
          track: "Other Track"
        }
      },
      {
        name: "vehicle",
        overrides: {
          vehicle: "Other Car"
        }
      },
      {
        name: "session",
        overrides: {
          session: "race"
        }
      },
      {
        name: "lap",
        overrides: {
          lap: 3
        }
      }
    ];

    for (const transition of transitions) {
      const authority =
        new CornerDiagnosisAuthority();

      authority.configure({
        model,
        reference: null
      });

      assert.deepEqual(
        authority.ingest(
          frame(
            0.09,
            4_000
          )
        ),
        []
      );

      assert.deepEqual(
        authority.ingest(
          frame(
            0.10,
            4_100
          )
        ),
        []
      );

      assert.deepEqual(
        authority.ingest(
          frame(
            0.14,
            4_200
          )
        ),
        []
      );

      const afterTransition =
        authority.ingest(
          frame(
            0.21,
            4_300,
            transition.overrides
          )
        );

      assert.deepEqual(
        afterTransition,
        [],
        transition.name
      );
    }
  }
);

test(
  "emits every overlapping corner completed by the same frame",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const overlappingModel: TrackModel = {
      track: "Test Track",
      version: 1,
      source: "learned",

      corners: [
        {
          id: "overlap-a",
          name: "Overlap A",
          entry: 0.10,
          apex: 0.15,
          exit: 0.20
        },
        {
          id: "overlap-b",
          name: "Overlap B",
          entry: 0.15,
          apex: 0.18,
          exit: 0.20
        }
      ]
    };

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model: overlappingModel,
      reference: null
    });

    const inside = [
      [0.09, 5_000],
      [0.10, 5_100],
      [0.15, 5_200],
      [0.18, 5_300],
      [0.20, 5_400]
    ] as const;

    for (
      const [distance, timestamp]
      of inside
    ) {
      assert.deepEqual(
        authority.ingest(
          frame(
            distance,
            timestamp
          )
        ),
        []
      );
    }

    const completed =
      authority.ingest(
        frame(
          0.21,
          5_500
        )
      );

    assert.deepEqual(
      completed
        .map(
          result =>
            result.corner.id
        )
        .sort(),
      [
        "overlap-a",
        "overlap-b"
      ]
    );

    assert.equal(
      completed.every(
        result =>
          result.completedAt ===
          5_500
      ),
      true
    );
  }
);

test(
  "does not diagnose a corner first observed after its entry",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference: null
    });

    assert.deepEqual(
      authority.ingest(
        frame(
          0.15,
          6_000
        )
      ),
      []
    );

    assert.deepEqual(
      authority.ingest(
        frame(
          0.18,
          6_100
        )
      ),
      []
    );

    const completed =
      authority.ingest(
        frame(
          0.21,
          6_200
        )
      );

    assert.deepEqual(
      completed,
      []
    );
  }
);


test(
  "closing one overlapping corner leaves the other window intact",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const staggeredModel: TrackModel = {
      track: "Test Track",
      version: 1,
      source: "learned",

      corners: [
        {
          id: "stagger-a",
          name: "Stagger A",
          entry: 0.10,
          apex: 0.15,
          exit: 0.20
        },
        {
          id: "stagger-b",
          name: "Stagger B",
          entry: 0.15,
          apex: 0.20,
          exit: 0.25
        }
      ]
    };

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model: staggeredModel,
      reference: null
    });

    const openingFrames = [
      [0.09, 7_000],
      [0.10, 7_100],
      [0.15, 7_200],
      [0.20, 7_300]
    ] as const;

    for (
      const [distance, timestamp]
      of openingFrames
    ) {
      assert.deepEqual(
        authority.ingest(
          frame(
            distance,
            timestamp
          )
        ),
        []
      );
    }

    const firstCompletion =
      authority.ingest(
        frame(
          0.21,
          7_400
        )
      );

    assert.deepEqual(
      firstCompletion.map(
        result =>
          result.corner.id
      ),
      [
        "stagger-a"
      ]
    );

    assert.deepEqual(
      authority.ingest(
        frame(
          0.24,
          7_500
        )
      ),
      []
    );

    const secondCompletion =
      authority.ingest(
        frame(
          0.26,
          7_600
        )
      );

    assert.deepEqual(
      secondCompletion.map(
        result =>
          result.corner.id
      ),
      [
        "stagger-b"
      ]
    );
  }
);


test(
  "explicit reset discards incomplete corner evidence",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference: null
    });

    assert.deepEqual(
      authority.ingest(
        frame(
          0.09,
          8_000
        )
      ),
      []
    );

    assert.deepEqual(
      authority.ingest(
        frame(
          0.10,
          8_100
        )
      ),
      []
    );

    assert.deepEqual(
      authority.ingest(
        frame(
          0.15,
          8_200
        )
      ),
      []
    );

    authority.reset();

    assert.deepEqual(
      authority.ingest(
        frame(
          0.21,
          8_300
        )
      ),
      []
    );
  }
);


test(
  "no-reference mode retains telemetry findings without trusted-reference findings",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference: null
    });

    const evidence = [
      frame(0.09, 9_000),
      frame(0.10, 9_100),
      frame(0.12, 9_200),
      frame(0.14, 9_300),
      frame(0.16, 9_400),
      frame(0.18, 9_500),
      frame(0.20, 9_600)
    ];

    for (const item of evidence) {
      assert.deepEqual(
        authority.ingest(item),
        []
      );
    }

    const completed =
      authority.ingest(
        frame(
          0.21,
          9_700
        )
      );

    assert.equal(
      completed.length,
      1
    );

    const diagnosis =
      completed[0]!.diagnosis;

    assert.equal(
      diagnosis.timing.state,
      "actual-only"
    );

    assert.equal(
      diagnosis.findings.some(
        finding =>
          finding.provenance ===
          "telemetry"
      ),
      true
    );

    assert.equal(
      diagnosis.findings.some(
        finding =>
          finding.provenance ===
          "trusted-reference"
      ),
      false
    );
  }
);


test(
  "valid trusted reference reaches C4 unchanged",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const trackedFrame = (
      lapDistance: number,
      timestamp: number,
      overrides: Partial<TelemetryFrame> = {}
    ): TelemetryFrame =>
      frame(
        lapDistance,
        timestamp,
        {
          trackLengthMeters: 5_000,
          ...overrides
        }
      );


    const reference:
      import("./pedal-graph.js")
        .PedalReferenceInput = {
      source: "expert",
      label: "Authority Expert",
      track: "Test Track",
      vehicle: "Test Car",

      frames: [
        trackedFrame(
          0.10,
          10_100,
          {
            lap: 1,
            brake: 0.8,
            throttle: 0
          }
        ),
        trackedFrame(
          0.12,
          10_200,
          {
            lap: 1,
            brake: 0.8,
            throttle: 0
          }
        ),
        trackedFrame(
          0.14,
          10_300,
          {
            lap: 1,
            brake: 0.8,
            throttle: 0
          }
        ),
        trackedFrame(
          0.16,
          10_400,
          {
            lap: 1,
            brake: 0.2,
            throttle: 0.6
          }
        ),
        trackedFrame(
          0.18,
          10_500,
          {
            lap: 1,
            brake: 0.2,
            throttle: 0.6
          }
        ),
        trackedFrame(
          0.20,
          10_600,
          {
            lap: 1,
            brake: 0.2,
            throttle: 0.6
          }
        )
      ]
    };

    const before =
      JSON.stringify(reference);

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference
    });

    const actual = [
      trackedFrame(0.09, 11_000),
      trackedFrame(0.10, 11_100),
      trackedFrame(0.12, 11_200),
      trackedFrame(0.14, 11_300),
      trackedFrame(0.16, 11_400),
      trackedFrame(0.18, 11_500),
      trackedFrame(0.20, 11_600)
    ];

    for (const item of actual) {
      assert.deepEqual(
        authority.ingest(item),
        []
      );
    }

    const completed =
      authority.ingest(
        trackedFrame(
          0.21,
          11_700
        )
      );

    assert.equal(
      completed.length,
      1
    );

    const diagnosis =
      completed[0]!.diagnosis;

    assert.equal(
      diagnosis.timing.state,
      "reference"
    );

    assert.equal(
      diagnosis.timing.referenceSource,
      "expert"
    );

    assert.equal(
      diagnosis.timing.referenceLabel,
      "Authority Expert"
    );

    assert.equal(
      diagnosis.findings.some(
        finding =>
          finding.provenance ===
            "trusted-reference" &&
          finding.referenceSource ===
            "expert" &&
          finding.referenceLabel ===
            "Authority Expert"
      ),
      true
    );

    assert.equal(
      JSON.stringify(reference),
      before
    );
  }
);


test(
  "corner diagnosis authority does not mutate actual telemetry input",
  async () => {
    const {
      CornerDiagnosisAuthority
    } = await import(
      "./corner-diagnosis-authority.js"
    );

    const authority =
      new CornerDiagnosisAuthority();

    authority.configure({
      model,
      reference: null
    });

    const actual = [
      frame(0.09, 12_000),
      frame(0.10, 12_100),
      frame(0.12, 12_200),
      frame(0.14, 12_300),
      frame(0.16, 12_400),
      frame(0.18, 12_500),
      frame(0.20, 12_600),
      frame(0.21, 12_700)
    ];

    const before =
      JSON.stringify(actual);

    for (const item of actual) {
      authority.ingest(item);
    }

    assert.equal(
      JSON.stringify(actual),
      before
    );
  }
);
