import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { simulatedFrame } from "./simulator.js";


interface LivePedalGraphPoint {
  offsetMs: number;
  brake: number;
  throttle: number;
}


interface LivePedalGraph {
  state: "reference" | "actual-only";

  referenceSource?:
    | "expert"
    | "community-benchmark"
    | "personal-best";

  referenceLabel?: string;

  actual: LivePedalGraphPoint[];
  reference: LivePedalGraphPoint[];
}


interface LiveStatePayload {
  type: "state";

  state: {
    source: string;

    frame: {
      timestamp: number;
    } | null;
  };

  pedalGraph?: LivePedalGraph;
}


function waitForPayload(
  socket: WebSocket,
  predicate: (
    payload: LiveStatePayload
  ) => boolean,
  timeoutMs = 2_000
): Promise<LiveStatePayload> {
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


      const onMessage = (
        data: WebSocket.RawData
      ): void => {
        let payload:
          LiveStatePayload;


        try {
          payload =
            JSON.parse(
              data.toString()
            ) as LiveStatePayload;
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


      const onError = (
        error: Error
      ): void => {
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


      const onOpen = (): void => {
        cleanup();

        resolve();
      };


      const onError = (
        error: Error
      ): void => {
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


test(
  "/live publishes bounded actual-only pedal graph data for LMU telemetry",
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
          "apex-pedal-live-"
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


    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );


    try {
      await waitForOpen(
        socket
      );


      const firstTimestamp =
        5_000_000;

      const secondTimestamp =
        5_000_100;


      const payloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.type ===
              "state" &&
            payload.state?.source ===
              "lmu" &&
            payload.state?.frame?.timestamp ===
              secondTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            firstTimestamp
          ),

          timestamp:
            firstTimestamp,

          session:
            "practice",

          track:
            "Test Track",

          vehicle:
            "Test Car",

          lap: 1,

          lapDistance:
            0.25,

          throttle:
            0.2,

          brake:
            0.7,

          gamePhase: 5,

          sessionTimeRemainingSeconds:
            300
        }),
        true
      );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            secondTimestamp
          ),

          timestamp:
            secondTimestamp,

          session:
            "practice",

          track:
            "Test Track",

          vehicle:
            "Test Car",

          lap: 1,

          lapDistance:
            0.30,

          throttle:
            0.4,

          brake:
            0.5,

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
        "actual-only"
      );


      assert.deepEqual(
        payload.pedalGraph.reference,
        []
      );


      assert.equal(
        payload.pedalGraph.referenceSource,
        undefined
      );


      assert.equal(
        payload.pedalGraph.referenceLabel,
        undefined
      );


      assert.deepEqual(
        payload.pedalGraph.actual,
        [
          {
            offsetMs:
              -100,

            brake:
              0.7,

            throttle:
              0.2
          },

          {
            offsetMs:
              0,

            brake:
              0.5,

            throttle:
              0.4
          }
        ]
      );
    }
    finally {
      if (
        socket.readyState !==
        WebSocket.CLOSED
      ) {
        socket.terminate();
      }


      await running.close();
    }
  }
);