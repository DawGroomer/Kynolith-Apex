import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPedalReference
} from "./pedal-reference.js";

import { simulatedFrame } from "./simulator.js";

import type {
  DrivingReference,
  RecordedLap,
  RecordedSession,
  TelemetryFrame
} from "./types.js";


function frame(
  timestamp: number,
  overrides: Partial<TelemetryFrame> = {}
): TelemetryFrame {
  return {
    ...simulatedFrame(timestamp),
    timestamp,
    session: "practice",
    track: "Test Track",
    vehicle: "Test Car",
    lap: 1,
    lapDistance: 0,
    throttle: 0.5,
    brake: 0.25,
    ...overrides
  };
}


function lapFrames(
  lap: number,
  durationSeconds: number,
  count = 30,
  overrides: Partial<TelemetryFrame> = {}
): TelemetryFrame[] {
  return Array.from(
    { length: count },
    (_, index) => {
      const ratio =
        count <= 1
          ? 0
          : index / (count - 1);

      return frame(
        1_000_000 +
          lap * 200_000 +
          ratio * durationSeconds * 1_000,
        {
          lap,
          lapDistance: ratio,
          throttle: ratio < 0.45 ? 0.15 : 0.85,
          brake: ratio > 0.2 && ratio < 0.4 ? 0.7 : 0,
          ...overrides
        }
      );
    }
  );
}


function recordedLap(
  lap: number,
  durationSeconds: number,
  options: {
    complete?: boolean;
    trusted?: boolean;
  } = {}
): RecordedLap {
  return {
    lap,
    durationSeconds,
    maxSpeedMph: 160,
    averageSpeedMph: 120,
    brakingSmoothness: 80,
    throttleSmoothness: 80,
    complete: options.complete !== false,

    quality: {
      version: 1,
      status:
        options.trusted === false
          ? "limited"
          : "trusted",
      score:
        options.trusted === false
          ? 40
          : 90,
      confidence:
        options.trusted === false
          ? "low"
          : "high",
      reasons: [],
      sampleCount: 30
    }
  } as RecordedLap;
}


function session(
  id: string,
  laps: RecordedLap[],
  frames: TelemetryFrame[],
  overrides: Partial<RecordedSession> = {}
): RecordedSession {
  return {
    summary: {
      id,
      startedAt: frames[0]?.timestamp ?? 1,
      endedAt: frames.at(-1)?.timestamp ?? 2,
      track: "Test Track",
      vehicle: "Test Car",
      session: "practice",
      laps,
      fastestLapSeconds:
        laps.length
          ? Math.min(
              ...laps.map(
                lap => lap.durationSeconds
              )
            )
          : null,
      consistencySeconds: null,
      maxSpeedMph: 160,
      coachCueCount: 0,
      primaryFocus: "test",
      quality: {
        version: 1,
        status: "trusted",
        score: 90,
        confidence: "high",
        reasons: [],
        sampleCount: frames.length
      }
    },

    frames,
    cues: [],

    ...overrides
  } as RecordedSession;
}


function expertReference(
  overrides: Partial<DrivingReference> = {}
): DrivingReference {
  const frames =
    lapFrames(
      1,
      90,
      60
    );

  return {
    id: "reference-expert",
    name: "Expert Lap",
    track: "Test Track",
    vehicle: "Test Car",
    importedAt: 1,
    lapTimeSeconds: 90,
    frames,
    ...overrides
  };
}


test("matched expert reference has authority over historical personal best", () => {
  const pbFrames =
    lapFrames(
      2,
      95
    );

  const history = [
    session(
      "session-pb",
      [
        recordedLap(
          2,
          95
        )
      ],
      pbFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: expertReference()
    });

  assert.ok(result);

  assert.equal(
    result.source,
    "expert"
  );

  assert.equal(
    result.label,
    "Expert Lap"
  );

  assert.equal(
    result.track,
    "Test Track"
  );

  assert.equal(
    result.vehicle,
    "Test Car"
  );

  assert.equal(
    result.frames.length,
    60
  );
});


test("community benchmark source is preserved", () => {
  const expert =
    expertReference({
      id: "reference-community",

      name:
        "Community Benchmark",

      benchmark: {
        type:
          "mylmu-community-benchmark",

        label:
          "MyLMU Community Benchmark",

        driver:
          "Benchmark Driver",

        sourceUrl:
          "local-test",

        observedAt:
          "2026-01-01",

        geometrySource:
          "driver-owned-lmu-duckdb",

        geometryLapSeconds:
          92,

        targetLapSeconds:
          90,

        targetLapRangeSeconds:
          [89.9, 90.1],

        sectors: [],
        targets: [],
        warnings: []
      }
    });

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: [],
      expert
    });

  assert.ok(result);

  assert.equal(
    result.source,
    "community-benchmark"
  );
});


test("wrong-track expert is rejected and trusted personal best is used", () => {
  const pbFrames =
    lapFrames(
      2,
      94
    );

  const history = [
    session(
      "session-pb",
      [
        recordedLap(
          2,
          94
        )
      ],
      pbFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,

      expert:
        expertReference({
          track: "Wrong Track"
        })
    });

  assert.ok(result);

  assert.equal(
    result.source,
    "personal-best"
  );

  assert.equal(
    result.frames[0]?.lap,
    2
  );
});


test("wrong-vehicle expert is rejected and trusted personal best is used", () => {
  const pbFrames =
    lapFrames(
      3,
      93
    );

  const history = [
    session(
      "session-pb",
      [
        recordedLap(
          3,
          93
        )
      ],
      pbFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,

      expert:
        expertReference({
          vehicle: "Wrong Car"
        })
    });

  assert.ok(result);

  assert.equal(
    result.source,
    "personal-best"
  );
});


test("expert with no usable frames falls back to trusted personal best", () => {
  const pbFrames =
    lapFrames(
      4,
      92
    );

  const history = [
    session(
      "session-pb",
      [
        recordedLap(
          4,
          92
        )
      ],
      pbFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,

      expert:
        expertReference({
          frames: []
        })
    });

  assert.ok(result);

  assert.equal(
    result.source,
    "personal-best"
  );
});


test("fastest trusted complete historical lap wins", () => {
  const slowFrames =
    lapFrames(
      1,
      100
    );

  const fastFrames =
    lapFrames(
      2,
      94
    );

  const history = [
    session(
      "session-slow",
      [
        recordedLap(
          1,
          100
        )
      ],
      slowFrames
    ),

    session(
      "session-fast",
      [
        recordedLap(
          2,
          94
        )
      ],
      fastFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: null
    });

  assert.ok(result);

  assert.equal(
    result.source,
    "personal-best"
  );

  assert.equal(
    result.frames[0]?.lap,
    2
  );
});


test("faster untrusted lap cannot become the pedal reference", () => {
  const untrustedFrames =
    lapFrames(
      1,
      88
    );

  const trustedFrames =
    lapFrames(
      2,
      96
    );

  const history = [
    session(
      "session-untrusted",
      [
        recordedLap(
          1,
          88,
          {
            trusted: false
          }
        )
      ],
      untrustedFrames
    ),

    session(
      "session-trusted",
      [
        recordedLap(
          2,
          96
        )
      ],
      trustedFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: null
    });

  assert.ok(result);

  assert.equal(
    result.frames[0]?.lap,
    2
  );
});


test("incomplete lap cannot become the pedal reference", () => {
  const incompleteFrames =
    lapFrames(
      1,
      90
    );

  const trustedFrames =
    lapFrames(
      2,
      97
    );

  const history = [
    session(
      "session-incomplete",
      [
        recordedLap(
          1,
          90,
          {
            complete: false
          }
        )
      ],
      incompleteFrames
    ),

    session(
      "session-trusted",
      [
        recordedLap(
          2,
          97
        )
      ],
      trustedFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: null
    });

  assert.ok(result);

  assert.equal(
    result.frames[0]?.lap,
    2
  );
});


test("lap at or below twenty seconds cannot become the pedal reference", () => {
  const shortFrames =
    lapFrames(
      1,
      20
    );

  const trustedFrames =
    lapFrames(
      2,
      95
    );

  const history = [
    session(
      "session-short",
      [
        recordedLap(
          1,
          20
        )
      ],
      shortFrames
    ),

    session(
      "session-valid",
      [
        recordedLap(
          2,
          95
        )
      ],
      trustedFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: null
    });

  assert.ok(result);

  assert.equal(
    result.frames[0]?.lap,
    2
  );
});


test("historical lap with fewer than twenty frames cannot become the reference", () => {
  const sparseFrames =
    lapFrames(
      1,
      90,
      19
    );

  const validFrames =
    lapFrames(
      2,
      96,
      20
    );

  const history = [
    session(
      "session-sparse",
      [
        recordedLap(
          1,
          90
        )
      ],
      sparseFrames
    ),

    session(
      "session-valid",
      [
        recordedLap(
          2,
          96
        )
      ],
      validFrames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: null
    });

  assert.ok(result);

  assert.equal(
    result.frames.length,
    20
  );

  assert.equal(
    result.frames[0]?.lap,
    2
  );
});


test("history from another track is ignored", () => {
  const wrongTrackFrames =
    lapFrames(
      1,
      90,
      30,
      {
        track: "Other Track"
      }
    );

  const wrongTrack =
    session(
      "session-other-track",
      [
        recordedLap(
          1,
          90
        )
      ],
      wrongTrackFrames
    );

  wrongTrack.summary.track =
    "Other Track";

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: [
        wrongTrack
      ],
      expert: null
    });

  assert.equal(
    result,
    null
  );
});


test("history from another vehicle is ignored", () => {
  const wrongVehicleFrames =
    lapFrames(
      1,
      90,
      30,
      {
        vehicle: "Other Car"
      }
    );

  const wrongVehicle =
    session(
      "session-other-car",
      [
        recordedLap(
          1,
          90
        )
      ],
      wrongVehicleFrames
    );

  wrongVehicle.summary.vehicle =
    "Other Car";

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: [
        wrongVehicle
      ],
      expert: null
    });

  assert.equal(
    result,
    null
  );
});


test("no trustworthy authority returns null", () => {
  const frames =
    lapFrames(
      1,
      90
    );

  const history = [
    session(
      "session-limited",
      [
        recordedLap(
          1,
          90,
          {
            trusted: false
          }
        )
      ],
      frames
    )
  ];

  const result =
    selectPedalReference({
      track: "Test Track",
      vehicle: "Test Car",
      sessions: history,
      expert: null
    });

  assert.equal(
    result,
    null
  );
});


test("reference selector never mutates expert or historical source data", () => {
  const expert =
    expertReference();

  const historyFrames =
    lapFrames(
      2,
      95
    );

  const history = [
    session(
      "session-pb",
      [
        recordedLap(
          2,
          95
        )
      ],
      historyFrames
    )
  ];

  const expertBefore =
    JSON.stringify(
      expert
    );

  const historyBefore =
    JSON.stringify(
      history
    );

  selectPedalReference({
    track: "Test Track",
    vehicle: "Test Car",
    sessions: history,
    expert
  });

  assert.equal(
    JSON.stringify(
      expert
    ),
    expertBefore
  );

  assert.equal(
    JSON.stringify(
      history
    ),
    historyBefore
  );
});