import assert from "node:assert/strict";

import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

import {
  FactualCoachingAuthority
} from "./factual-coaching-authority.js";

import {
  claims
} from "./factual-coaching-claim.js";

import type {
  RunningCoachServer
} from "./server.js";

import {
  simulatedFrame
} from "./simulator.js";


interface LivePayload {
  state: {
    frame: {
      timestamp: number;
    } | null;
  };
  cue?: {
    id: string;
    message: string;
  } | null;
}


function waitForOpen(
  socket: WebSocket,
  timeoutMs = 2_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Timed out opening /live WebSocket"
        )
      );
    }, timeoutMs);

    const onOpen = (): void => {
      cleanup();
      resolve();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
    }

    socket.on("open", onOpen);
    socket.on("error", onError);
  });
}


function waitForFrame(
  socket: WebSocket,
  timestamp: number,
  timeoutMs = 2_000
): Promise<LivePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for processed telemetry timestamp ${timestamp}`
        )
      );
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData): void => {
      let payload: LivePayload;

      try {
        payload =
          JSON.parse(
            data.toString()
          ) as LivePayload;
      }
      catch {
        return;
      }

      if (
        payload.state.frame?.timestamp !==
          timestamp
      ) {
        return;
      }

      cleanup();
      resolve(payload);
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    }

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}


test(
  "routes a completed C5C finding through C5D claims to /live",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-factual-coaching-"
        )
      );

    let running:
      RunningCoachServer | undefined;
    let socket:
      WebSocket | undefined;

    try {
      await mkdir(
        path.join(
          dataDir,
          "track-models"
        ),
        {
          recursive: true
        }
      );

      await writeFile(
        path.join(
          dataDir,
          "track-models",
          "test-track.json"
        ),
        JSON.stringify({
          track: "Test Track",
          version: 1,
          source: "learned",
          corners: [
            {
              id: "server-t1",
              name: "Server Turn 1",
              entry: 0.10,
              apex: 0.15,
              exit: 0.20
            }
          ]
        }),
        "utf8"
      );

      await writeFile(
        path.join(
          dataDir,
          "settings.json"
        ),
        JSON.stringify({
          speechFrequency: "active"
        }),
        "utf8"
      );

      const {
        startCoachServer
      } = await import(
        "./server.js"
      );

      running =
        await startCoachServer({
          port: 0,
          publicDir: path.resolve("public"),
          dataDir,
          allowModelDownloads: false,
          prewarmVoices: false
        });

      socket =
        new WebSocket(
          `ws://127.0.0.1:${running.port}/live`
        );

      await waitForOpen(socket);

      const frame = (
        lapDistance: number,
        timestamp: number
      ) => ({
        ...simulatedFrame(timestamp),
        track: "Test Track",
        vehicle: "Test Car",
        session: "practice" as const,
        lap: 2,
        lapDistance,
        brake:
          lapDistance === 0.16
            ? 0
            : lapDistance >= 0.21
              ? 0
              : lapDistance <= 0.14
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
            : 0.02
      });

      const liveCues: {
        id: string;
        message: string;
      }[] = [];

      const evidence = [
        [0.09, 10_000],
        [0.10, 10_100],
        [0.12, 10_200],
        [0.14, 10_300],
        [0.16, 10_400],
        [0.18, 30_500],
        [0.20, 30_600],
        [0.21, 30_700]
      ] as const;

      for (
        const [distance, timestamp]
        of evidence
      ) {
        const processed =
          waitForFrame(
            socket,
            timestamp
          );

        assert.equal(
          running.ingestTelemetry(
            frame(
              distance,
              timestamp
            )
          ),
          true
        );

        const payload =
          await processed;

        if (
          payload.cue
        ) {
          liveCues.push(
            payload.cue
          );
        }
      }

      const flushTimestamp =
        30_800;
      const flushProcessed =
        waitForFrame(
          socket,
          flushTimestamp
        );

      assert.equal(
        running.ingestTelemetry({
          ...frame(
            0.21,
            flushTimestamp
          ),
          brake: 0,
          throttle: 0.5,
          steering: 0,
          lateralG: 0
        }),
        true
      );

      const flushPayload =
        await flushProcessed;

      if (
        flushPayload.cue
      ) {
        liveCues.push(
          flushPayload.cue
        );
      }

      const legacyCornerTail = [
        51_000,
        51_100,
        51_200,
        51_300
      ] as const;

      for (
        const timestamp
        of legacyCornerTail
      ) {
        const processed =
          waitForFrame(
            socket,
            timestamp
          );

        assert.equal(
          running.ingestTelemetry(
            {
              ...frame(
                0.21,
                timestamp
              ),
              lateralG: 0
            }
          ),
          true
        );

        const payload =
          await processed;

        if (
          payload.cue
        ) {
          liveCues.push(
            payload.cue
          );
        }
      }

      const history =
        running.cornerDiagnoses();

      assert.equal(
        history.length,
        1
      );

      const completed =
        history[0]!;
      const c5cFinding =
        completed.diagnosis.findings.find(
          finding =>
            finding.skill === "braking" &&
            finding.concept === "release-shape"
        );

      assert.ok(c5cFinding);
      assert.equal(
        c5cFinding.status,
        "abrupt"
      );
      assert.equal(
        c5cFinding.provenance,
        "telemetry"
      );

      const decisions =
        new FactualCoachingAuthority().decisions(
          completed
        );

      assert.equal(
        decisions.length,
        completed.diagnosis.findings.length
      );

      const factualClaims =
        claims(
          decisions
        );

      assert.equal(
        factualClaims.length,
        decisions.length
      );

      assert.equal(
        factualClaims.some(
          claim =>
            claim.message ===
              "Brake release was abrupt."
        ),
        true
      );

      assert.equal(
        factualClaims.every(
          claim =>
            !/reference|target|earlier|later|expert|personal best/i.test(
              claim.message
            )
        ),
        true
      );

      const claimMessages =
        new Set(
          factualClaims.map(
            claim => claim.message
          )
        );

      assert.ok(
        liveCues.some(
          cue => claimMessages.has(cue.message)
        ),
        "A C5D factual claim did not reach the /live coaching cue output"
      );

      const legacyPedalCornerCues =
        liveCues.filter(
          cue =>
            /^(corner-review|corner-clean|coast|throttle-stab|clean-exit|steering-spike)-/.test(
              cue.id
            )
        );

      assert.deepEqual(
        legacyPedalCornerCues,
        [],
        "Legacy raw pedal/corner coaching duplicated the C5D factual cue"
      );
    }
    finally {
      if (
        socket &&
        socket.readyState !==
          WebSocket.CLOSED
      ) {
        socket.terminate();
      }

      if (
        running
      ) {
        await running.close();
      }

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
        delete process.env.KYNOLITH_DESKTOP;
      }
      else {
        process.env.KYNOLITH_DESKTOP =
          previousDesktop;
      }
    }
  }
);
