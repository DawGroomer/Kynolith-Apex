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
  simulatedFrame
} from "./simulator.js";


interface LivePayload {
  type: "state";
  state: {
    frame: {
      timestamp: number;
    } | null;
  };
}


function waitForOpen(
  socket: WebSocket,
  timeoutMs = 2_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out opening /live WebSocket"));
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


function waitForTimestamp(
  socket: WebSocket,
  timestamp: number,
  timeoutMs = 2_000
): Promise<void> {
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
          JSON.parse(data.toString()) as LivePayload;
      }
      catch {
        return;
      }

      if (payload.state.frame?.timestamp !== timestamp) {
        return;
      }

      cleanup();
      resolve();
    };

    function cleanup(): void {
      clearTimeout(timer);
      socket.off("message", onMessage);
    }

    socket.on("message", onMessage);
  });
}


test(
  "running server exposes an initially empty corner diagnosis history",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-"
        )
      );

    const {
      startCoachServer
    } =
      await import(
        "./server.js"
      );

    const running =
      await startCoachServer({
        port: 0,
        publicDir:
          path.resolve(
            "public"
          ),
        dataDir,
        allowModelDownloads: false,
        prewarmVoices: false
      });

    try {
      const cornerDiagnoses =
        (
          running as unknown as {
            cornerDiagnoses?:
              () => unknown[];
          }
        ).cornerDiagnoses;

      assert.equal(
        typeof cornerDiagnoses,
        "function"
      );

      if (
        typeof cornerDiagnoses !==
        "function"
      ) {
        return;
      }

      assert.deepEqual(
        cornerDiagnoses.call(
          running
        ),
        []
      );

      const exposedHistory =
        cornerDiagnoses.call(
          running
        );

      exposedHistory.push({});

      assert.deepEqual(
        cornerDiagnoses.call(
          running
        ),
        []
      );
    }
    finally {
      await running.close();

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

test(
  "running server records a completed diagnosis from matching track model telemetry",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-live-"
        )
      );

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

    const {
      startCoachServer
    } =
      await import(
        "./server.js"
      );

    const running =
      await startCoachServer({
        port: 0,
        publicDir:
          path.resolve(
            "public"
          ),
        dataDir,
        allowModelDownloads: false,
        prewarmVoices: false
      });

    const frame = (
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(
        timestamp
      ),

      track: "Test Track",
      vehicle: "Test Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,

      brake:
        lapDistance <= 0.14
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

    try {
      const evidence = [
        [0.09, 1_000],
        [0.10, 1_100],
        [0.12, 1_200],
        [0.14, 1_300],
        [0.16, 1_400],
        [0.18, 1_500],
        [0.20, 1_600],
        [0.21, 1_700]
      ] as const;

      for (
        const [distance, timestamp]
        of evidence
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(
              distance,
              timestamp
            )
          ),
          true
        );
      }

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.cornerDiagnoses()
          .length === 0
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              10
            )
        );
      }

      const history =
        running.cornerDiagnoses();

      assert.equal(
        history.length,
        1
      );

      assert.equal(
        history[0]!.track,
        "Test Track"
      );

      assert.equal(
        history[0]!.vehicle,
        "Test Car"
      );

      assert.equal(
        history[0]!.session,
        "practice"
      );

      assert.equal(
        history[0]!.lap,
        2
      );

      assert.equal(
        history[0]!.corner.id,
        "server-t1"
      );

      assert.equal(
        history[0]!.completedAt,
        1_700
      );

      assert.equal(
        history[0]!.diagnosis.findings.some(
          finding =>
            finding.provenance ===
              "trusted-reference"
        ),
        false
      );
    }
    finally {
      await running.close();

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

test(
  "running server retains only the newest 100 completed corner diagnoses",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-cap-"
        )
      );

    await mkdir(
      path.join(
        dataDir,
        "track-models"
      ),
      {
        recursive: true
      }
    );

    const corners =
      Array.from(
        {
          length: 101
        },
        (_, index) => ({
          id:
            `cap-${index + 1}`,
          name:
            `Cap Corner ${index + 1}`,
          entry: 0.10,
          apex: 0.15,
          exit: 0.20
        })
      );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "cap-track.json"
      ),
      JSON.stringify({
        track: "Cap Track",
        version: 1,
        source: "learned",
        corners
      }),
      "utf8"
    );

    const {
      startCoachServer
    } =
      await import(
        "./server.js"
      );

    const running =
      await startCoachServer({
        port: 0,
        publicDir:
          path.resolve(
            "public"
          ),
        dataDir,
        allowModelDownloads: false,
        prewarmVoices: false
      });

    const frame = (
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(
        timestamp
      ),

      track: "Cap Track",
      vehicle: "Cap Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,

      brake:
        lapDistance <= 0.14
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

    try {
      const evidence = [
        [0.09, 20_000],
        [0.10, 20_100],
        [0.15, 20_200],
        [0.20, 20_300],
        [0.21, 20_400]
      ] as const;

      for (
        const [distance, timestamp]
        of evidence
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(
              distance,
              timestamp
            )
          ),
          true
        );
      }

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.cornerDiagnoses()
          .length === 0
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              10
            )
        );
      }

      const history =
        running.cornerDiagnoses();

      assert.equal(
        history.length,
        100
      );

      assert.equal(
        history[0]!.corner.id,
        "cap-2"
      );

      assert.equal(
        history.at(-1)!.corner.id,
        "cap-101"
      );
    }
    finally {
      await running.close();

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

test(
  "profile reset discards incomplete corner diagnosis evidence",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-profile-reset-"
        )
      );

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
        "profile-reset-track.json"
      ),
      JSON.stringify({
        track: "Profile Reset Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "profile-reset-t1",
            name: "Profile Reset Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const frame = (
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Profile Reset Track",
      vehicle: "Profile Reset Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,
      gamePhase: 5,
      sessionTimeRemainingSeconds: 300,
      brake:
        lapDistance <= 0.14
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

    try {
      for (
        const [distance, timestamp]
        of [
          [0.09, 40_000],
          [0.10, 40_100],
          [0.15, 40_200]
        ] as const
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(distance, timestamp)
          ),
          true
        );
      }

      const reset =
        await fetch(
          "http://127.0.0.1:" +
            running.port +
            "/api/profile/reset",
          { method: "POST" }
        );

      assert.equal(
        reset.status,
        204
      );

      const processedBefore =
        running.telemetryMetrics()
          .processed;

      assert.equal(
        running.ingestTelemetry(
          frame(0.21, 40_300)
        ),
        true
      );

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.telemetryMetrics()
          .processed <
          processedBefore + 1
      ) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 10)
        );
      }

      assert.equal(
        running.telemetryMetrics()
          .processed,
        processedBefore + 1
      );

      assert.equal(
        running.cornerDiagnoses()
          .length,
        0
      );

      // Reset must discard old evidence without
      // permanently disabling this LMU context.
      const freshEvidence = [
        [0.09, 41_000],
        [0.10, 41_100],
        [0.12, 41_200],
        [0.14, 41_300],
        [0.16, 41_400],
        [0.18, 41_500],
        [0.20, 41_600],
        [0.21, 41_700]
      ] as const;

      const processedAfterReset =
        running.telemetryMetrics()
          .processed;

      for (
        const [distance, timestamp]
        of freshEvidence
      ) {
        assert.equal(
          running.ingestTelemetry({
            ...frame(
              distance,
              timestamp
            ),
            lap: 3
          }),
          true
        );
      }

      const freshDeadline =
        Date.now() + 2_000;

      while (
        Date.now() < freshDeadline &&
        running.telemetryMetrics()
          .processed <
          processedAfterReset +
            freshEvidence.length
      ) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 10)
        );
      }

      assert.equal(
        running.telemetryMetrics()
          .processed,
        processedAfterReset +
          freshEvidence.length
      );

      const freshHistory =
        running.cornerDiagnoses();

      assert.equal(
        freshHistory.length,
        1
      );

      assert.equal(
        freshHistory[0]!.lap,
        3
      );

      assert.equal(
        freshHistory[0]!.corner.id,
        "profile-reset-t1"
      );
    }

    finally {
      await running.close();

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


test(
  "disconnect prevents incomplete corner diagnosis leakage",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-disconnect-"
        )
      );

    await mkdir(
      path.join(dataDir, "track-models"),
      { recursive: true }
    );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "disconnect-diagnosis-track.json"
      ),
      JSON.stringify({
        track: "Disconnect Diagnosis Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "disconnect-t1",
            name: "Disconnect Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const frame = (
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Disconnect Diagnosis Track",
      vehicle: "Disconnect Diagnosis Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,
      gamePhase: 5,
      sessionTimeRemainingSeconds: 300,
      brake:
        lapDistance <= 0.14
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

    try {
      for (
        const [distance, timestamp]
        of [
          [0.09, 50_000],
          [0.10, 50_100],
          [0.15, 50_200]
        ] as const
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(distance, timestamp)
          ),
          true
        );
      }

      await running.disconnectTelemetry();

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );

      const processedBeforeReconnect =
        running.telemetryMetrics()
          .processed;

      assert.equal(
        running.ingestTelemetry(
          frame(0.21, 50_300)
        ),
        true
      );

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.telemetryMetrics()
          .processed <
          processedBeforeReconnect + 1
      ) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 10)
        );
      }

      assert.equal(
        running.telemetryMetrics()
          .processed,
        processedBeforeReconnect + 1
      );

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );
    }
    finally {
      await running.close();

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


test(
  "manual stop prevents incomplete corner diagnosis leakage",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-stop-"
        )
      );

    await mkdir(
      path.join(dataDir, "track-models"),
      { recursive: true }
    );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "manual-stop-diagnosis-track.json"
      ),
      JSON.stringify({
        track: "Manual Stop Diagnosis Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "manual-stop-t1",
            name: "Manual Stop Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const frame = (
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Manual Stop Diagnosis Track",
      vehicle: "Manual Stop Diagnosis Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,
      gamePhase: 5,
      sessionTimeRemainingSeconds: 300,
      brake:
        lapDistance <= 0.14
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

    try {
      for (
        const [distance, timestamp]
        of [
          [0.09, 60_000],
          [0.10, 60_100],
          [0.15, 60_200]
        ] as const
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(distance, timestamp)
          ),
          true
        );
      }

      const stopResponse =
        await fetch(
          "http://127.0.0.1:" +
            running.port +
            "/api/session/stop",
          {
            method: "POST"
          }
        );

      assert.equal(
        stopResponse.status,
        200
      );

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );

      const processedBeforeAfterStop =
        running.telemetryMetrics()
          .processed;

      assert.equal(
        running.ingestTelemetry(
          frame(0.21, 60_300)
        ),
        true
      );

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.telemetryMetrics()
          .processed <
          processedBeforeAfterStop + 1
      ) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 10)
        );
      }

      assert.equal(
        running.telemetryMetrics()
          .processed,
        processedBeforeAfterStop + 1
      );

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );
    }
    finally {
      await running.close();

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


test(
  "session transition prevents incomplete corner diagnosis leakage and rearms fresh ownership",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-session-transition-"
        )
      );

    await mkdir(
      path.join(dataDir, "track-models"),
      { recursive: true }
    );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "session-transition-diagnosis-track.json"
      ),
      JSON.stringify({
        track: "Session Transition Diagnosis Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "session-transition-t1",
            name: "Session Transition Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const frame = (
      session: "practice" | "qualifying",
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Session Transition Diagnosis Track",
      vehicle: "Session Transition Diagnosis Car",
      session,
      lap: 2,
      lapDistance,
      gamePhase: 5,
      sessionTimeRemainingSeconds: 300,
      brake:
        lapDistance <= 0.14
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

    try {
      for (
        const [distance, timestamp]
        of [
          [0.09, 70_000],
          [0.10, 70_100],
          [0.15, 70_200]
        ] as const
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame("practice", distance, timestamp)
          ),
          true
        );
      }

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );

      const processedBeforeTransition =
        running.telemetryMetrics()
          .processed;

      assert.equal(
        running.ingestTelemetry(
          frame("qualifying", 0.05, 71_000)
        ),
        true
      );

      assert.equal(
        running.ingestTelemetry(
          frame("practice", 0.21, 71_100)
        ),
        true
      );

      const qualifyingEvidence = [
        [0.09, 71_200],
        [0.10, 71_300],
        [0.15, 71_400],
        [0.21, 71_500]
      ] as const;

      for (
        const [distance, timestamp]
        of qualifyingEvidence
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame("qualifying", distance, timestamp)
          ),
          true
        );
      }

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.telemetryMetrics()
          .processed <
          processedBeforeTransition +
            6
      ) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 10)
        );
      }

      const history =
        running.cornerDiagnoses();

      assert.equal(
        history.length,
        1
      );

      assert.equal(
        history[0]!.session,
        "qualifying"
      );

      assert.equal(
        history[0]!.corner.id,
        "session-transition-t1"
      );
    }
    finally {
      await running.close();

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


test(
  "sustained terminal boundary prevents incomplete corner diagnosis leakage",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-terminal-"
        )
      );

    await mkdir(
      path.join(dataDir, "track-models"),
      { recursive: true }
    );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "terminal-diagnosis-track.json"
      ),
      JSON.stringify({
        track: "Terminal Diagnosis Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "terminal-t1",
            name: "Terminal Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const frame = (
      lapDistance: number,
      timestamp: number,
      terminal = false
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Terminal Diagnosis Track",
      vehicle: "Terminal Diagnosis Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,
      gamePhase: terminal ? 8 : 5,
      sessionTimeRemainingSeconds:
        terminal ? 0 : 300,
      inPits: terminal,
      brake:
        lapDistance <= 0.14
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

    try {
      const processedBeforeEvidence =
        running.telemetryMetrics()
          .processed;

      for (
        const [distance, timestamp]
        of [
          [0.09, 80_000],
          [0.10, 80_100],
          [0.15, 80_200]
        ] as const
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(distance, timestamp)
          ),
          true
        );
      }

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );

      for (
        const timestamp of [
          80_300,
          80_400,
          80_500
        ]
      ) {
        assert.equal(
          running.ingestTelemetry(
            frame(0.30, timestamp, true)
          ),
          true
        );
      }

      assert.equal(
        running.ingestTelemetry(
          frame(0.21, 80_600)
        ),
        true
      );

      const deadline =
        Date.now() + 2_000;

      while (
        Date.now() < deadline &&
        running.telemetryMetrics()
          .processed <
          processedBeforeEvidence + 7
      ) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 10)
        );
      }

      assert.equal(
        running.telemetryMetrics()
          .processed,
        processedBeforeEvidence + 7
      );

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );
    }
    finally {
      await running.close();

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


test(
  "transient terminal candidate does not complete or discard an active corner diagnosis",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-transient-terminal-"
        )
      );

    await mkdir(
      path.join(dataDir, "track-models"),
      { recursive: true }
    );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "terminal-diagnosis-track.json"
      ),
      JSON.stringify({
        track: "Terminal Diagnosis Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "terminal-t1",
            name: "Terminal Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );

    const frame = (
      lapDistance: number,
      timestamp: number,
      terminal = false
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Terminal Diagnosis Track",
      vehicle: "Terminal Diagnosis Car",
      session: "practice" as const,
      lap: 2,
      lapDistance,
      gamePhase: terminal ? 8 : 5,
      sessionTimeRemainingSeconds:
        terminal ? 0 : 300,
      inPits: terminal,
      brake:
        lapDistance <= 0.14
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

    try {
      await waitForOpen(socket);

      for (
        const [distance, timestamp]
        of [
          [0.09, 101_000],
          [0.10, 101_100],
          [0.15, 101_200]
        ] as const
      ) {
        const processed =
          waitForTimestamp(
            socket,
            timestamp
          );

        assert.equal(
          running.ingestTelemetry(
            frame(distance, timestamp)
          ),
          true
        );

        await processed;
      }

      const terminalProcessed =
        waitForTimestamp(
          socket,
          101_300
        );

      assert.equal(
        running.ingestTelemetry(
          frame(0.30, 101_300, true)
        ),
        true
      );

      await terminalProcessed;

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );

      const resumedProcessed =
        waitForTimestamp(
          socket,
          101_400
        );

      assert.equal(
        running.ingestTelemetry(
          frame(0.21, 101_400)
        ),
        true
      );

      await resumedProcessed;

      const history =
        running.cornerDiagnoses();

      assert.equal(
        history.length,
        1
      );

      assert.equal(
        history[0]!.completedAt,
        101_400
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


test(
  "unsupported sessions never establish or continue C5C corner-diagnosis ownership",
  async () => {
    const previousDesktop =
      process.env.KYNOLITH_DESKTOP;

    process.env.KYNOLITH_DESKTOP =
      "1";

    const dataDir =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "apex-corner-diagnosis-unsupported-session-"
        )
      );

    await mkdir(
      path.join(dataDir, "track-models"),
      { recursive: true }
    );

    await writeFile(
      path.join(
        dataDir,
        "track-models",
        "unsupported-session-diagnosis-track.json"
      ),
      JSON.stringify({
        track: "Unsupported Session Diagnosis Track",
        version: 1,
        source: "learned",
        corners: [
          {
            id: "unsupported-session-t1",
            name: "Unsupported Session Turn 1",
            entry: 0.10,
            apex: 0.15,
            exit: 0.20
          }
        ]
      }),
      "utf8"
    );

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

    const socket =
      new WebSocket(
        `ws://127.0.0.1:${running.port}/live`
      );

    const frame = (
      session: "practice" | "unknown",
      lapDistance: number,
      timestamp: number
    ) => ({
      ...simulatedFrame(timestamp),
      track: "Unsupported Session Diagnosis Track",
      vehicle: "Unsupported Session Diagnosis Car",
      session,
      lap: 2,
      lapDistance,
      gamePhase: 5,
      sessionTimeRemainingSeconds: 300,
      inPits: false,
      brake:
        lapDistance <= 0.14
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

    const ingestAndWait = async (
      session: "practice" | "unknown",
      lapDistance: number,
      timestamp: number
    ) => {
      const processed =
        waitForTimestamp(
          socket,
          timestamp
        );

      assert.equal(
        running.ingestTelemetry(
          frame(session, lapDistance, timestamp)
        ),
        true
      );

      await processed;
    };

    try {
      await waitForOpen(socket);

      await ingestAndWait("practice", 0.09, 110_000);
      await ingestAndWait("practice", 0.10, 110_100);
      await ingestAndWait("practice", 0.15, 110_200);

      await ingestAndWait("unknown", 0.30, 110_300);

      assert.deepEqual(
        running.cornerDiagnoses(),
        []
      );

      await ingestAndWait("unknown", 0.09, 110_400);
      await ingestAndWait("unknown", 0.10, 110_500);
      await ingestAndWait("unknown", 0.15, 110_600);
      await ingestAndWait("unknown", 0.21, 110_700);

      assert.deepEqual(
        running.cornerDiagnoses(),
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
