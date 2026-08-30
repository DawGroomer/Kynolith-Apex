import assert from "node:assert/strict";
import test from "node:test";

import { CoachingEngine } from "./coaching.js";
import { simulatedFrame } from "./simulator.js";
import type { TelemetryFrame } from "./types.js";


function cuesAtCurriculumLevelThree(
  controls: Pick<
    TelemetryFrame,
    "brake" | "steering" | "throttle"
  >
) {
  const engine = new CoachingEngine();
  engine.setCurriculumLevel(3);

  engine.ingest({
    ...simulatedFrame(100_000),
    brake: 0,
    steering: 0,
    throttle: 0
  });

  return engine.ingest({
    ...simulatedFrame(120_000),
    ...controls
  });
}


function assertIntrinsicGuidance(
  cues: ReturnType<CoachingEngine["ingest"]>,
  id: string,
  message: string
) {
  const unauthorizedReferenceClaims =
    cues.filter(
      cue =>
        /\b(match|hold|compare)\b.*\breference\b/i.test(
          cue.message
        )
    );

  assert.deepEqual(
    unauthorizedReferenceClaims,
      []
  );

  const guidanceCue =
    cues.find(
      cue => cue.id === id
    );

  assert.ok(guidanceCue);
  assert.equal(
    guidanceCue.message,
    message
  );
}


test(
  "curriculum level alone cannot emit reference-relative brake coaching",
  () => {
    assertIntrinsicGuidance(
      cuesAtCurriculumLevelThree({
        brake: 0.3,
        steering: 0,
        throttle: 0
      }),
      "coach-reference-brake-120000",
      "Release the brake smoothly and protect apex speed."
    );
  }
);


test(
  "curriculum level alone cannot emit reference-relative steering coaching",
  () => {
    assertIntrinsicGuidance(
      cuesAtCurriculumLevelThree({
        brake: 0,
        steering: 0.5,
        throttle: 0
      }),
      "coach-reference-arc-120000",
      "Hold a clean arc. Minimize scrub."
    );
  }
);


test(
  "curriculum level alone cannot emit reference-relative exit coaching",
  () => {
    assertIntrinsicGuidance(
      cuesAtCurriculumLevelThree({
        brake: 0,
        steering: 0,
        throttle: 0.9
      }),
      "coach-reference-exit-120000",
      "Good. Keep the exit clean and progressive."
    );
  }
);
