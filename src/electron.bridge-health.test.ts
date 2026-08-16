import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("bridge health policy disconnects first, then restarts a sustained telemetry stall", () => {
  const {
    evaluateBridgeHealth
  } = require("../electron/bridge-health.cjs");

  const firstFrameAt = 100_000;

  assert.deepEqual(
    evaluateBridgeHealth({
      now: 101_000,
      lastFrameAt: firstFrameAt,
      disconnectReported: false
    }),
    {
      disconnect: false,
      restart: false
    }
  );

  assert.deepEqual(
    evaluateBridgeHealth({
      now: 103_000,
      lastFrameAt: firstFrameAt,
      disconnectReported: false
    }),
    {
      disconnect: true,
      restart: false
    }
  );

  assert.deepEqual(
    evaluateBridgeHealth({
      now: 104_000,
      lastFrameAt: firstFrameAt,
      disconnectReported: true
    }),
    {
      disconnect: false,
      restart: false
    }
  );

  assert.deepEqual(
    evaluateBridgeHealth({
      now: 116_000,
      lastFrameAt: firstFrameAt,
      disconnectReported: true
    }),
    {
      disconnect: false,
      restart: true
    }
  );
});

test("bridge health policy does not restart before telemetry has ever been seen", () => {
  const {
    evaluateBridgeHealth
  } = require("../electron/bridge-health.cjs");

  assert.deepEqual(
    evaluateBridgeHealth({
      now: 500_000,
      lastFrameAt: 0,
      disconnectReported: false
    }),
    {
      disconnect: false,
      restart: false
    }
  );
});
