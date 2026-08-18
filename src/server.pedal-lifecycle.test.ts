import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WebSocket } from "ws";

import { simulatedFrame } from "./simulator.js";


interface PedalGraphPoint {
  offsetMs: number;
  brake: number;
  throttle: number;
}


interface PedalGraphPayload {
  state: "reference" | "actual-only";
  referenceSource?: "expert" | "community-benchmark" | "personal-best";
  referenceLabel?: string;
  actual: PedalGraphPoint[];
  reference: PedalGraphPoint[];
}


interface LivePayload {
  type: "state";

  state: {
    connected: boolean;
    source: "lmu" | "simulator";
    sessionActive?: boolean;

    frame: {
      timestamp: number;
    } | null;
  };

  pedalGraph?: PedalGraphPayload;
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


function waitForPayload(
  socket: WebSocket,
  predicate: (payload: LivePayload) => boolean,
  timeoutMs = 2_000
): Promise<LivePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();

      reject(
        new Error(
          "Timed out waiting for matching /live lifecycle payload"
        )
      );
    }, timeoutMs);


    const onMessage = (
      data: WebSocket.RawData
    ): void => {
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


      if (!predicate(payload)) {
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
  "LMU disconnect explicitly releases pedal graph ownership",
  async () => {
    process.env.KYNOLITH_DESKTOP = "1";


    const {
      startCoachServer
    } = await import("./server.js");


    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-pedal-disconnect-"
        )
      );


    const running =
      await startCoachServer({
        port: 0,
        publicDir: path.resolve("public"),
        dataDir,
        prewarmVoices: false
      });


    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );


    try {
      await waitForOpen(socket);


      const timestamp =
        7_000_000;


      const activePayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.frame?.timestamp === timestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(timestamp),

          timestamp,

          session: "practice",

          track:
            "Disconnect Test Track",

          vehicle:
            "Disconnect Test Car",

          lap: 2,

          lapDistance: 0.4,

          throttle: 0.7,

          brake: 0.2,

          gamePhase: 5,

          sessionTimeRemainingSeconds:
            300
        }),
        true
      );


      const activePayload =
        await activePayloadPromise;


      assert.ok(
        activePayload.pedalGraph
      );


      assert.ok(
        activePayload.pedalGraph.actual.length >
          0
      );


      const disconnectedPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === false &&
            payload.state?.source === "simulator" &&
            payload.state?.sessionActive === false &&
            payload.state?.frame?.timestamp === timestamp
        );


      await running.disconnectTelemetry();


      const disconnectedPayload =
        await disconnectedPayloadPromise;


      assert.ok(
        disconnectedPayload.pedalGraph,
        "disconnect payload must include pedalGraph"
      );


      assert.equal(
        disconnectedPayload.pedalGraph.state,
        "actual-only"
      );


      assert.deepEqual(
        disconnectedPayload.pedalGraph.actual,
        []
      );


      assert.deepEqual(
        disconnectedPayload.pedalGraph.reference,
        []
      );


      assert.equal(
        disconnectedPayload.pedalGraph.referenceSource,
        undefined
      );


      assert.equal(
        disconnectedPayload.pedalGraph.referenceLabel,
        undefined
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

test(
  "manual stop releases the pedal graph and prevents same-session reacquisition",
  async () => {
    process.env.KYNOLITH_DESKTOP = "1";


    const {
      startCoachServer
    } = await import("./server.js");


    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-pedal-manual-stop-"
        )
      );


    const running =
      await startCoachServer({
        port: 0,
        publicDir: path.resolve("public"),
        dataDir,
        prewarmVoices: false
      });


    const base =
      `http://127.0.0.1:${running.port}`;


    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );


    try {
      await waitForOpen(socket);


      const firstTimestamp =
        8_000_000;


      const activePayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.frame?.timestamp ===
              firstTimestamp
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
            "Manual Stop Test Track",

          vehicle:
            "Manual Stop Test Car",

          lap:
            2,

          lapDistance:
            0.45,

          throttle:
            0.75,

          brake:
            0.15,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            300
        }),
        true
      );


      const activePayload =
        await activePayloadPromise;


      assert.ok(
        activePayload.pedalGraph
      );


      assert.ok(
        activePayload.pedalGraph.actual.length >
          0
      );


      /*
       * The stop action itself owns the release.
       *
       * We require a payload carrying the SAME final
       * LMU frame timestamp so a later simulator or
       * telemetry frame cannot satisfy this assertion
       * accidentally.
       */
      const stoppedPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === false &&
            payload.state?.frame?.timestamp ===
              firstTimestamp
        );


      const stopResponse =
        await fetch(
          `${base}/api/session/stop`,
          {
            method: "POST"
          }
        );


      assert.equal(
        stopResponse.status,
        200
      );


      const stoppedPayload =
        await stoppedPayloadPromise;


      assert.ok(
        stoppedPayload.pedalGraph,
        "manual-stop payload must include pedalGraph"
      );


      assert.equal(
        stoppedPayload.pedalGraph.state,
        "actual-only"
      );


      assert.deepEqual(
        stoppedPayload.pedalGraph.actual,
        []
      );


      assert.deepEqual(
        stoppedPayload.pedalGraph.reference,
        []
      );


      /*
       * Critical ownership proof:
       *
       * LMU can continue sending telemetry after the
       * user manually stops coaching. That SAME session
       * must not silently reacquire the pedal graph.
       */
      const secondTimestamp =
        firstTimestamp + 100;


      const heldPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === false &&
            payload.state?.frame?.timestamp ===
              secondTimestamp
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
            "Manual Stop Test Track",

          vehicle:
            "Manual Stop Test Car",

          lap:
            2,

          lapDistance:
            0.46,

          throttle:
            0.8,

          brake:
            0.1,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            299.9
        }),
        true
      );


      const heldPayload =
        await heldPayloadPromise;


      assert.ok(
        heldPayload.pedalGraph
      );


      assert.equal(
        heldPayload.pedalGraph.state,
        "actual-only"
      );


      assert.deepEqual(
        heldPayload.pedalGraph.actual,
        []
      );


      assert.deepEqual(
        heldPayload.pedalGraph.reference,
        []
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


test(
  "a legitimate new LMU session reacquires the pedal graph on its first frame",
  async () => {
    process.env.KYNOLITH_DESKTOP = "1";


    const {
      startCoachServer
    } = await import("./server.js");


    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-pedal-rearm-"
        )
      );


    const running =
      await startCoachServer({
        port: 0,
        publicDir: path.resolve("public"),
        dataDir,
        prewarmVoices: false
      });


    const base =
      `http://127.0.0.1:${running.port}`;


    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );


    try {
      await waitForOpen(socket);


      const practiceTimestamp =
        9_000_000;


      const practicePayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === true &&
            payload.state?.frame?.timestamp ===
              practiceTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            practiceTimestamp
          ),

          timestamp:
            practiceTimestamp,

          session:
            "practice",

          track:
            "Rearm Test Track",

          vehicle:
            "Rearm Test Car",

          lap:
            2,

          lapDistance:
            0.3,

          throttle:
            0.6,

          brake:
            0.25,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            300
        }),
        true
      );


      const practicePayload =
        await practicePayloadPromise;


      assert.ok(
        practicePayload.pedalGraph
      );


      assert.ok(
        practicePayload.pedalGraph.actual.length >
          0
      );


      const stoppedPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === false &&
            payload.state?.frame?.timestamp ===
              practiceTimestamp
        );


      const stopResponse =
        await fetch(
          `${base}/api/session/stop`,
          {
            method: "POST"
          }
        );


      assert.equal(
        stopResponse.status,
        200
      );


      const stoppedPayload =
        await stoppedPayloadPromise;


      assert.ok(
        stoppedPayload.pedalGraph
      );


      assert.deepEqual(
        stoppedPayload.pedalGraph.actual,
        []
      );


      assert.deepEqual(
        stoppedPayload.pedalGraph.reference,
        []
      );


      /*
       * Different supported session = legitimate rearm.
       *
       * The first qualifying frame itself must become
       * graph-owned. Requiring this exact timestamp
       * prevents a later frame from hiding a one-frame
       * lifecycle delay.
       */
      const qualifyingTimestamp =
        practiceTimestamp + 1_000;


      const rearmedPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === true &&
            payload.state?.frame?.timestamp ===
              qualifyingTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            qualifyingTimestamp
          ),

          timestamp:
            qualifyingTimestamp,

          session:
            "qualifying",

          track:
            "Rearm Test Track",

          vehicle:
            "Rearm Test Car",

          lap:
            1,

          lapDistance:
            0.05,

          throttle:
            0.5,

          brake:
            0.1,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            600
        }),
        true
      );


      const rearmedPayload =
        await rearmedPayloadPromise;


      assert.ok(
        rearmedPayload.pedalGraph,
        "rearmed payload must include pedalGraph"
      );


      assert.equal(
        rearmedPayload.pedalGraph.state,
        "actual-only"
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual.length,
        1
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual[0]?.offsetMs,
        0
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual[0]?.throttle,
        0.5
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual[0]?.brake,
        0.1
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

test(
  "sustained terminal session releases pedal graph ownership and holds it released",
  async () => {
    process.env.KYNOLITH_DESKTOP = "1";


    const {
      startCoachServer
    } = await import("./server.js");


    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-pedal-terminal-"
        )
      );


    const running =
      await startCoachServer({
        port: 0,
        publicDir: path.resolve("public"),
        dataDir,
        prewarmVoices: false
      });


    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );


    try {
      await waitForOpen(socket);


      const activeTimestamp =
        10_000_000;


      const activePayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === true &&
            payload.state?.frame?.timestamp ===
              activeTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            activeTimestamp
          ),

          timestamp:
            activeTimestamp,

          session:
            "practice",

          track:
            "Terminal Test Track",

          vehicle:
            "Terminal Test Car",

          lap:
            3,

          lapDistance:
            0.8,

          throttle:
            0.4,

          brake:
            0.35,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            120
        }),
        true
      );


      const activePayload =
        await activePayloadPromise;


      assert.ok(
        activePayload.pedalGraph
      );


      assert.ok(
        activePayload.pedalGraph.actual.length >
          0
      );


      /*
       * Terminal detection is intentionally sustained.
       *
       * Frames:
       *   +0 ms
       *   +100 ms
       *   +200 ms
       *
       * The third frame establishes the terminal state.
       */
      const terminalTimes = [
        activeTimestamp + 1_000,
        activeTimestamp + 1_100,
        activeTimestamp + 1_200
      ];


      for (
        let index = 0;
        index < terminalTimes.length - 1;
        index++
      ) {
        const timestamp =
          terminalTimes[index]!;


        assert.equal(
          running.ingestTelemetry({
            ...simulatedFrame(
              timestamp
            ),

            timestamp,

            session:
              "practice",

            track:
              "Terminal Test Track",

            vehicle:
              "Terminal Test Car",

            lap:
              3,

            lapDistance:
              0.99,

            throttle:
              0,

            brake:
              1,

            gamePhase:
              8,

            sessionTimeRemainingSeconds:
              0,

            inPits:
              true
          }),
          true
        );
      }


      const sustainedTimestamp =
        terminalTimes[2]!;


      const terminalPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === false &&
            payload.state?.frame?.timestamp ===
              sustainedTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            sustainedTimestamp
          ),

          timestamp:
            sustainedTimestamp,

          session:
            "practice",

          track:
            "Terminal Test Track",

          vehicle:
            "Terminal Test Car",

          lap:
            3,

          lapDistance:
            1,

          throttle:
            0,

          brake:
            1,

          gamePhase:
            8,

          sessionTimeRemainingSeconds:
            0,

          inPits:
            true
        }),
        true
      );


      const terminalPayload =
        await terminalPayloadPromise;


      assert.ok(
        terminalPayload.pedalGraph,
        "terminal payload must include pedalGraph"
      );


      assert.equal(
        terminalPayload.pedalGraph.state,
        "actual-only"
      );


      assert.deepEqual(
        terminalPayload.pedalGraph.actual,
        []
      );


      assert.deepEqual(
        terminalPayload.pedalGraph.reference,
        []
      );


      /*
       * A later terminal frame must not reacquire
       * ownership after terminal release.
       */
      const heldTimestamp =
        activeTimestamp + 1_300;


      const heldPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === false &&
            payload.state?.frame?.timestamp ===
              heldTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            heldTimestamp
          ),

          timestamp:
            heldTimestamp,

          session:
            "practice",

          track:
            "Terminal Test Track",

          vehicle:
            "Terminal Test Car",

          lap:
            3,

          lapDistance:
            1,

          throttle:
            0,

          brake:
            1,

          gamePhase:
            8,

          sessionTimeRemainingSeconds:
            0,

          inPits:
            true
        }),
        true
      );


      const heldPayload =
        await heldPayloadPromise;


      assert.ok(
        heldPayload.pedalGraph
      );


      assert.deepEqual(
        heldPayload.pedalGraph.actual,
        []
      );


      assert.deepEqual(
        heldPayload.pedalGraph.reference,
        []
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

test(
  "first non-terminal frame after terminal completion reacquires the pedal graph",
  async () => {
    process.env.KYNOLITH_DESKTOP = "1";


    const {
      startCoachServer
    } = await import("./server.js");


    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-pedal-terminal-rearm-"
        )
      );


    const running =
      await startCoachServer({
        port: 0,
        publicDir: path.resolve("public"),
        dataDir,
        prewarmVoices: false
      });


    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );


    try {
      await waitForOpen(socket);


      const activeTimestamp =
        11_000_000;


      const activePayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === true &&
            payload.state?.frame?.timestamp ===
              activeTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            activeTimestamp
          ),

          timestamp:
            activeTimestamp,

          session:
            "practice",

          track:
            "Terminal Rearm Track",

          vehicle:
            "Terminal Rearm Car",

          lap:
            4,

          lapDistance:
            0.8,

          throttle:
            0.5,

          brake:
            0.2,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            120
        }),
        true
      );


      await activePayloadPromise;


      const terminalTimes = [
        activeTimestamp + 1_000,
        activeTimestamp + 1_100,
        activeTimestamp + 1_200
      ];


      for (
        let index = 0;
        index < terminalTimes.length;
        index++
      ) {
        const timestamp =
          terminalTimes[index]!;


        const terminalPayloadPromise =
          index === 2
            ? waitForPayload(
                socket,
                payload =>
                  payload.state?.connected === true &&
                  payload.state?.source === "lmu" &&
                  payload.state?.sessionActive === false &&
                  payload.state?.frame?.timestamp ===
                    timestamp
              )
            : null;


        assert.equal(
          running.ingestTelemetry({
            ...simulatedFrame(
              timestamp
            ),

            timestamp,

            session:
              "practice",

            track:
              "Terminal Rearm Track",

            vehicle:
              "Terminal Rearm Car",

            lap:
              4,

            lapDistance:
              1,

            throttle:
              0,

            brake:
              1,

            gamePhase:
              8,

            sessionTimeRemainingSeconds:
              0,

            inPits:
              true
          }),
          true
        );


        if (terminalPayloadPromise) {
          const terminalPayload =
            await terminalPayloadPromise;


          assert.ok(
            terminalPayload.pedalGraph
          );


          assert.deepEqual(
            terminalPayload.pedalGraph.actual,
            []
          );
        }
      }


      /*
       * Same track / car / session type is deliberate.
       *
       * We are proving that terminal ownership itself
       * is released correctly. The test must not rely
       * on a different session key to clean things up.
       */
      const rearmTimestamp =
        activeTimestamp + 2_000;


      const rearmedPayloadPromise =
        waitForPayload(
          socket,
          payload =>
            payload.state?.connected === true &&
            payload.state?.source === "lmu" &&
            payload.state?.sessionActive === true &&
            payload.state?.frame?.timestamp ===
              rearmTimestamp
        );


      assert.equal(
        running.ingestTelemetry({
          ...simulatedFrame(
            rearmTimestamp
          ),

          timestamp:
            rearmTimestamp,

          session:
            "practice",

          track:
            "Terminal Rearm Track",

          vehicle:
            "Terminal Rearm Car",

          lap:
            1,

          lapDistance:
            0.02,

          throttle:
            0.55,

          brake:
            0.05,

          gamePhase:
            5,

          sessionTimeRemainingSeconds:
            900,

          inPits:
            false
        }),
        true
      );


      const rearmedPayload =
        await rearmedPayloadPromise;


      assert.ok(
        rearmedPayload.pedalGraph,
        "rearmed payload must include pedalGraph"
      );


      assert.equal(
        rearmedPayload.pedalGraph.state,
        "actual-only"
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual.length,
        1
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual[0]?.offsetMs,
        0
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual[0]?.throttle,
        0.55
      );


      assert.equal(
        rearmedPayload.pedalGraph.actual[0]?.brake,
        0.05
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