import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { simulatedFrame } from "./simulator.js";


interface PedalPoint {
  offsetMs: number;
  brake: number;
  throttle: number;
}


interface PedalGraph {
  state:
    | "reference"
    | "actual-only";

  referenceSource?:
    | "expert"
    | "community-benchmark"
    | "personal-best";

  referenceLabel?: string;

  actual: PedalPoint[];
  reference: PedalPoint[];
}


interface LivePayload {
  type: "state";

  state: {
    source: string;

    frame: {
      timestamp: number;
    } | null;
  };

  pedalGraph?: PedalGraph;
}


function waitForOpen(
  socket: WebSocket,
  timeoutMs = 2_000
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(
          () => {
            cleanup();

            reject(
              new Error(
                "Timed out opening /live WebSocket"
              )
            );
          },
          timeoutMs
        );


      const onOpen =
        (): void => {
          cleanup();
          resolve();
        };


      const onError =
        (error: Error): void => {
          cleanup();
          reject(error);
        };


      function cleanup(): void {
        clearTimeout(timer);

        socket.off(
          "open",
          onOpen
        );

        socket.off(
          "error",
          onError
        );
      }


      socket.on(
        "open",
        onOpen
      );

      socket.on(
        "error",
        onError
      );
    }
  );
}


function waitForPayload(
  socket: WebSocket,
  predicate: (
    payload: LivePayload
  ) => boolean,
  timeoutMs = 2_000
): Promise<LivePayload> {
  return new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(
          () => {
            cleanup();

            reject(
              new Error(
                "Timed out waiting for matching /live payload"
              )
            );
          },
          timeoutMs
        );


      const onMessage =
        (
          data: WebSocket.RawData
        ): void => {
          let payload:
            LivePayload;


          try {
            payload =
              JSON.parse(
                data.toString()
              ) as LivePayload;
          }
          catch {
            return;
          }


          if (!predicate(payload)) {
            return;
          }


          cleanup();

          resolve(payload);
        };


      const onError =
        (error: Error): void => {
          cleanup();
          reject(error);
        };


      function cleanup(): void {
        clearTimeout(timer);

        socket.off(
          "message",
          onMessage
        );

        socket.off(
          "error",
          onError
        );
      }


      socket.on(
        "message",
        onMessage
      );

      socket.on(
        "error",
        onError
      );
    }
  );
}


function referenceFrames() {
  return Array.from(
    { length: 60 },
    (_, index) => {
      const ratio =
        index / 59;

      const timestamp =
        10_000 +
        index * 100;


      return {
        ...simulatedFrame(
          timestamp
        ),

        timestamp,

        session:
          "practice" as const,

        track:
          "Test Track",

        vehicle:
          "Test Car",

        lap: 1,

        lapDistance:
          ratio,

        throttle:
          ratio,

        brake:
          1 - ratio,

        gamePhase: 5,

        sessionTimeRemainingSeconds:
          300
      };
    }
  );
}


test(
  "/live activates a matched expert pedal reference for the LMU session",
  async () => {
    process.env.KYNOLITH_DESKTOP =
      "1";


    const {
      startCoachServer
    } = await import(
      "./server.js"
    );


    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-pedal-reference-"
        )
      );


    const running =
      await startCoachServer({
        port: 0,

        publicDir:
          path.resolve(
            "public"
          ),

        dataDir,

        prewarmVoices: false
      });


    const base =
      `http://127.0.0.1:${running.port}`;


    let socket:
      WebSocket | null =
        null;


    try {
      const imported =
        await fetch(
          `${base}/api/references/import`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                name:
                  "Expert Coach Lap",

                track:
                  "Test Track",

                vehicle:
                  "Test Car",

                frames:
                  referenceFrames()
              })
          }
        );


      assert.equal(
        imported.status,
        201
      );


      socket =
        new WebSocket(
          `ws://127.0.0.1:${running.port}/live`
        );


      await waitForOpen(
        socket
      );


      const timestamp =
        6_000_000;


      const payloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.type ===
              "state" &&
            payload.state?.source ===
              "lmu" &&
            payload.state?.frame?.timestamp ===
              timestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            timestamp
          ),

          timestamp,

          session:
            "practice",

          track:
            "Test Track",

          vehicle:
            "Test Car",

          lap: 2,

          lapDistance:
            0.5,

          throttle:
            0.35,

          brake:
            0.65,

          gamePhase: 5,

          sessionTimeRemainingSeconds:
            300
        }),
        true
      );


      const payload =
        await payloadPromise;


      assert.ok(
        payload.pedalGraph,
        "/live state payload must include pedalGraph"
      );


      assert.equal(
        payload.pedalGraph.state,
        "reference"
      );


      assert.equal(
        payload.pedalGraph.referenceSource,
        "expert"
      );


      assert.equal(
        payload.pedalGraph.referenceLabel,
        "Expert Coach Lap"
      );


      assert.ok(
        payload.pedalGraph.reference.length >
          0
      );


      const now =
        payload.pedalGraph.reference.find(
          point =>
            point.offsetMs ===
            0
        );


      assert.ok(
        now,
        "reference trace must contain an interpolated NOW point"
      );


      assert.ok(
        Math.abs(
          now.throttle -
          0.5
        ) <
          1e-9
      );


      assert.ok(
        Math.abs(
          now.brake -
          0.5
        ) <
          1e-9
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


      await running.close();
    }
  }
);