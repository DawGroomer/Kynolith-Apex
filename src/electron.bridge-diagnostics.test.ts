import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { writeBridgeDiagnostic } = require(
  "../electron/bridge-diagnostics.cjs"
);

test("bridge diagnostics ignore a synchronous EPIPE from a closed sink", () => {
  const error = Object.assign(
    new Error("broken pipe"),
    { code: "EPIPE" }
  );

  const sink = {
    writable: true,
    destroyed: false,
    writableEnded: false,
    write() {
      throw error;
    }
  };

  assert.doesNotThrow(() => {
    writeBridgeDiagnostic(sink, "[LMU bridge] diagnostic\n");
  });
});

test("bridge diagnostics absorb an asynchronously emitted EPIPE", async () => {
  const error = Object.assign(
    new Error("broken pipe"),
    { code: "EPIPE" }
  );

  class AsyncErrorSink extends EventEmitter {
    writable = true;
    destroyed = false;
    writableEnded = false;

    write() {
      queueMicrotask(() => this.emit("error", error));
      return true;
    }
  }

  const sink = new AsyncErrorSink();
  let uncaught: unknown;
  const onUncaught = (cause: unknown) => {
    uncaught = cause;
  };

  process.once("uncaughtException", onUncaught);
  writeBridgeDiagnostic(sink, "[LMU bridge] diagnostic\n");
  await new Promise<void>(resolve => setImmediate(resolve));
  process.removeListener("uncaughtException", onUncaught);

  assert.equal(uncaught, undefined);
});

test("bridge diagnostics do not swallow non-EPIPE sink failures", () => {
  const error = Object.assign(
    new Error("unexpected sink failure"),
    { code: "EIO" }
  );

  const sink = {
    writable: true,
    destroyed: false,
    writableEnded: false,
    write() {
      throw error;
    }
  };

  assert.throws(
    () => writeBridgeDiagnostic(sink, "[LMU bridge] diagnostic\n"),
    cause => cause === error
  );
});
