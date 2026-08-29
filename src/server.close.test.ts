import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionRecorder } from "./session-recorder.js";
import {
  simulatedFrame
} from "./simulator.js";
import type { TelemetryFrame } from "./types.js";


test(
  "server close waits for accepted telemetry before returning",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-server-close-"
        )
      );

    let recorderStarted =
      false;
    let releaseRecorder!: () => void;
    let signalRecorderStarted!: () => void;
    const recorderStartedPromise =
      new Promise<void>(resolve => {
        signalRecorderStarted = resolve;
      });
    const recorderRelease =
      new Promise<void>(resolve => {
        releaseRecorder = resolve;
      });
    const originalRecordFrame =
      SessionRecorder.prototype.recordFrame;

    SessionRecorder.prototype.recordFrame =
      async function(
        this: SessionRecorder,
        frame: TelemetryFrame
      ): Promise<void> {
        if (!recorderStarted) {
          recorderStarted = true;
          signalRecorderStarted();
          await recorderRelease;
        }
        await originalRecordFrame.call(this, frame);
      };

    const { startCoachServer } =
      await import("./server.js");

    const running =
      await startCoachServer({
        port: 0,
        publicDir: path.resolve("public"),
        dataDir,
        allowModelDownloads: false,
        prewarmVoices: false
      });

    try {
      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(90_000),
          track: "Server Close Track",
          vehicle: "Server Close Car",
          session: "practice",
          lap: 1,
          lapDistance: 0.10,
          gamePhase: 5,
          sessionTimeRemainingSeconds: 300
        }),
        true
      );

      await recorderStartedPromise;

      let closeSettled = false;
      const closePromise = running.close().then(() => {
        closeSettled = true;
      });

      await new Promise(
        resolve => setTimeout(resolve, 50)
      );

      assert.equal(
        closeSettled,
        false,
        "close returned while recorder work was still active"
      );

      releaseRecorder();
      await closePromise;
    }
    finally {
      SessionRecorder.prototype.recordFrame =
        originalRecordFrame;
      releaseRecorder();
      await rm(
        dataDir,
        {
          recursive: true,
          force: true
        }
      );

      if (
        previousDesktop ===
        undefined
      ) {
        delete process.env
          .KYNOLITH_DESKTOP;
      }
      else {
        process.env
          .KYNOLITH_DESKTOP =
          previousDesktop;
      }
    }
  }
);
