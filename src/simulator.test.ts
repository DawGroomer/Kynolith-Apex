import assert from "node:assert/strict";
import test from "node:test";

import {
  simulatedFrame
} from "./simulator.js";


test(
  "default simulator frames use elapsed simulator time for lap progression instead of Unix epoch time",
  () => {
    const originalNow =
      Date.now;


    let now =
      1_786_000_000_000;


    Date.now =
      () => now;


    try {
      const first =
        simulatedFrame();


      assert.equal(
        first.timestamp,
        now
      );


      assert.equal(
        first.lap,
        1
      );


      assert.equal(
        first.lapDistance,
        0
      );


      now +=
        89_999;


      const beforeLine =
        simulatedFrame();


      assert.equal(
        beforeLine.timestamp,
        now
      );


      assert.equal(
        beforeLine.lap,
        1
      );


      assert.ok(
        beforeLine.lapDistance > 0.99 &&
        beforeLine.lapDistance < 1
      );


      now +=
        2;


      const nextLap =
        simulatedFrame();


      assert.equal(
        nextLap.timestamp,
        now
      );


      assert.equal(
        nextLap.lap,
        2
      );


      assert.ok(
        nextLap.lapDistance >= 0 &&
        nextLap.lapDistance < 0.001
      );
    }
    finally {
      Date.now =
        originalNow;
    }
  }
);


test(
  "explicit simulator timestamps retain deterministic legacy fixture timing",
  () => {
    const frame =
      simulatedFrame(
        180_000
      );


    assert.equal(
      frame.timestamp,
      180_000
    );


    assert.equal(
      frame.lap,
      3
    );


    assert.equal(
      frame.lapDistance,
      0
    );
  }
);