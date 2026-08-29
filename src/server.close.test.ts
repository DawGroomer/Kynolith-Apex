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
    let dataDir: string | undefined;
    let originalRecordFrame:
      | typeof SessionRecorder.prototype.recordFrame
      | undefined;

    process.env.KYNOLITH_DESKTOP =
      "1";

    let recorderStarted =
      false;
    let releaseRecorder:
      (() => void) | undefined;
    let signalRecorderStarted!: () => void;
    const recorderStartedPromise =
      new Promise<void>(resolve => {
        signalRecorderStarted = resolve;
      });
    const recorderRelease =
      new Promise<void>(resolve => {
        releaseRecorder = resolve;
      });
    let closePromise:
      Promise<void> | undefined;

    try {
      dataDir =
        await mkdtemp(
          path.join(
            os.tmpdir(),
            "apex-server-close-"
          )
        );

      originalRecordFrame =
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
          await originalRecordFrame!.call(this, frame);
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
        closePromise = running.close();
        void closePromise.then(
          () => {
            closeSettled = true;
          },
          () => {
            closeSettled = true;
          }
        );

        await new Promise(
          resolve => setTimeout(resolve, 50)
        );

        assert.equal(
          closeSettled,
          false,
          "close returned while recorder work was still active"
        );

        releaseRecorder?.();
        await closePromise;
      }
      finally {
        releaseRecorder?.();
        if (!closePromise) {
          closePromise = running.close();
        }
        await closePromise.catch(() => {});
      }
    }
    finally {
      if (originalRecordFrame !== undefined) {
        SessionRecorder.prototype.recordFrame =
          originalRecordFrame;
      }
      releaseRecorder?.();
      if (dataDir !== undefined) {
        await rm(
          dataDir,
          {
            recursive: true,
            force: true
          }
        );
      }

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
