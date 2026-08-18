import assert from "node:assert/strict";
import test from "node:test";

import {
  PedalGraphModel,
  type PedalReferenceInput
} from "./pedal-graph.js";

import { simulatedFrame } from "./simulator.js";
import type { TelemetryFrame } from "./types.js";


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
    lapDistance: 0.25,
    throttle: 0,
    brake: 0,
    ...overrides
  };
}


function validReference(
  overrides: Partial<PedalReferenceInput> = {}
): PedalReferenceInput {
  const frames: TelemetryFrame[] = [
    frame(10_000, {
      lapDistance: 0,
      brake: 0,
      throttle: 1
    }),

    frame(11_000, {
      lapDistance: 0.25,
      brake: 0.2,
      throttle: 0.8
    }),

    frame(12_000, {
      lapDistance: 0.5,
      brake: 0.6,
      throttle: 0.4
    }),

    frame(13_000, {
      lapDistance: 0.75,
      brake: 0.3,
      throttle: 0.7
    }),

    frame(14_000, {
      lapDistance: 1,
      brake: 0,
      throttle: 1
    })
  ];

  return {
    source: "expert",
    label: "Coach Lap",
    track: "Test Track",
    vehicle: "Test Car",
    frames,
    ...overrides
  };
}


test("retains live throttle and brake samples", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(1_000, {
    throttle: 0.25,
    brake: 0.75
  }));

  model.ingest(frame(1_100, {
    throttle: 0.5,
    brake: 0.4
  }));

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");

  assert.deepEqual(
    snapshot.actual.map(point => ({
      offsetMs: point.offsetMs,
      throttle: point.throttle,
      brake: point.brake
    })),
    [
      {
        offsetMs: -100,
        throttle: 0.25,
        brake: 0.75
      },
      {
        offsetMs: 0,
        throttle: 0.5,
        brake: 0.4
      }
    ]
  );
});


test("expires actual history older than 2500 milliseconds", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(1_000, {
    throttle: 0.1
  }));

  model.ingest(frame(2_500, {
    throttle: 0.5
  }));

  model.ingest(frame(3_600, {
    throttle: 0.9
  }));

  const snapshot = model.snapshot();

  assert.deepEqual(
    snapshot.actual.map(point => point.offsetMs),
    [-1_100, 0]
  );

  assert.deepEqual(
    snapshot.actual.map(point => point.throttle),
    [0.5, 0.9]
  );
});


test("track change resets actual history", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(1_000, {
    throttle: 0.2
  }));

  model.ingest(frame(1_100, {
    track: "Other Track",
    throttle: 0.8
  }));

  const snapshot = model.snapshot();

  assert.equal(snapshot.actual.length, 1);
  assert.equal(snapshot.actual[0]?.throttle, 0.8);
  assert.equal(snapshot.actual[0]?.offsetMs, 0);
});


test("vehicle change resets actual history", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(1_000, {
    brake: 0.2
  }));

  model.ingest(frame(1_100, {
    vehicle: "Other Car",
    brake: 0.8
  }));

  const snapshot = model.snapshot();

  assert.equal(snapshot.actual.length, 1);
  assert.equal(snapshot.actual[0]?.brake, 0.8);
});


test("session type change resets actual history", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(1_000, {
    session: "practice"
  }));

  model.ingest(frame(1_100, {
    session: "qualifying"
  }));

  assert.equal(
    model.snapshot().actual.length,
    1
  );
});


test("normal lap transition does not reset rolling history", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(1_000, {
    lap: 1,
    lapDistance: 0.99
  }));

  model.ingest(frame(1_100, {
    lap: 2,
    lapDistance: 0.01
  }));

  assert.equal(
    model.snapshot().actual.length,
    2
  );
});


test("valid matched reference activates reference state", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference()
  );

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "reference");
  assert.equal(snapshot.referenceSource, "expert");
  assert.equal(snapshot.referenceLabel, "Coach Lap");
  assert.ok(snapshot.reference.length > 0);
});


test("track-mismatched reference fails closed to actual-only", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference({
      track: "Wrong Track"
    })
  );

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");
  assert.deepEqual(snapshot.reference, []);
});


test("vehicle-mismatched reference fails closed to actual-only", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference({
      vehicle: "Wrong Car"
    })
  );

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");
  assert.deepEqual(snapshot.reference, []);
});


test("invalid reference pedal values fail closed", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  const reference = validReference();

  reference.frames[2] = {
    ...reference.frames[2]!,
    throttle: 1.2
  };

  model.setReference(reference);

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");
  assert.deepEqual(snapshot.reference, []);
});


test("non-finite reference pedal values fail closed", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  const reference = validReference();

  reference.frames[2] = {
    ...reference.frames[2]!,
    brake: Number.NaN
  };

  model.setReference(reference);

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");
  assert.deepEqual(snapshot.reference, []);
});


test("reference must cover the current lap position", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.2
  }));

  const reference = validReference({
    frames: [
      frame(10_000, {
        lapDistance: 0.6,
        brake: 0.8,
        throttle: 0.1
      }),

      frame(11_000, {
        lapDistance: 0.7,
        brake: 0.5,
        throttle: 0.3
      }),

      frame(12_000, {
        lapDistance: 0.8,
        brake: 0.1,
        throttle: 0.7
      })
    ]
  });

  model.setReference(reference);

  assert.equal(
    model.snapshot().state,
    "actual-only"
  );
});


test("interpolates reference pedal values at the current lap position", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference()
  );

  const now = model
    .snapshot()
    .reference
    .find(point => point.offsetMs === 0);

  assert.ok(now);

  assert.ok(
    Math.abs(now.brake - 0.4) < 1e-9
  );

  assert.ok(
    Math.abs(now.throttle - 0.6) < 1e-9
  );
});


test("reference trace spans past, now, and immediate future", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference()
  );

  const offsets = model
    .snapshot()
    .reference
    .map(point => point.offsetMs);

  assert.ok(
    offsets.some(offset => offset < 0)
  );

  assert.ok(
    offsets.includes(0)
  );

  assert.ok(
    offsets.some(offset => offset > 0)
  );
});


test("reference output stays inside the graph time window", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference()
  );

  const offsets = model
    .snapshot()
    .reference
    .map(point => point.offsetMs);

  assert.ok(
    offsets.every(
      offset =>
        offset >= -2_500 &&
        offset <= 1_500
    )
  );

  assert.equal(
    offsets.includes(2_500),
    false
  );
});


test("no reference produces actual-only state", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375,
    throttle: 0.7,
    brake: 0
  }));

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");
  assert.deepEqual(snapshot.reference, []);
  assert.equal(snapshot.actual.length, 1);
});


test("reset clears live history and reference state", () => {
  const model = new PedalGraphModel();

  model.ingest(frame(50_000, {
    lapDistance: 0.375
  }));

  model.setReference(
    validReference()
  );

  assert.equal(
    model.snapshot().state,
    "reference"
  );

  model.reset();

  const snapshot = model.snapshot();

  assert.equal(snapshot.state, "actual-only");
  assert.deepEqual(snapshot.actual, []);
  assert.deepEqual(snapshot.reference, []);
});


test("pedal graph model never mutates source telemetry frames", () => {
  const model = new PedalGraphModel();

  const live = frame(50_000, {
    lapDistance: 0.375,
    throttle: 0.55,
    brake: 0.25
  });

  const reference = validReference();

  const liveBefore = JSON.stringify(live);
  const referenceBefore = JSON.stringify(reference.frames);

  model.ingest(live);
  model.setReference(reference);
  model.snapshot();

  assert.equal(
    JSON.stringify(live),
    liveBefore
  );

  assert.equal(
    JSON.stringify(reference.frames),
    referenceBefore
  );
});