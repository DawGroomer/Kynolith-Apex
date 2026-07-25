import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { simulatedFrame } from "./simulator.js";

test("desktop server records LMU frames and exposes session review", async () => {
  process.env.KYNOLITH_DESKTOP = "1";
  const { startCoachServer } = await import("./server.js");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "apex-server-"));
  const running = await startCoachServer({ port: 0, publicDir: path.resolve("public"), dataDir });
  const base = `http://127.0.0.1:${running.port}`;
  try {
    for (let i = 0; i < 220; i++) {
      const timestamp = 1_000_000 + i * 150;
      const response = await fetch(`${base}/api/telemetry`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...simulatedFrame(timestamp), timestamp, lap: Math.floor(i / 80) + 1, lapDistance: (i % 80) / 80 }) });
      assert.equal(response.status, 202);
    }
    await fetch(`${base}/api/telemetry/disconnect`, { method: "POST" });
    await new Promise(resolve => setTimeout(resolve, 80));
    const sessions = await fetch(`${base}/api/sessions`).then(response => response.json()) as Array<{ id: string }>;
    assert.equal(sessions.length, 1);
    const review = await fetch(`${base}/api/sessions/${sessions[0]!.id}`).then(response => response.json()) as { frames: unknown[] };
    assert.ok(review.frames.length > 100);
  } finally { await running.close(); }
});

test("LMU terminal game phase finalizes the session without a disconnect", async () => {
  process.env.KYNOLITH_DESKTOP = "1";
  const { startCoachServer } = await import("./server.js");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "apex-terminal-"));
  const running = await startCoachServer({ port: 0, publicDir: path.resolve("public"), dataDir });
  try {
    for (let index = 0; index < 900; index++) {
      const timestamp = 2_000_000 + index * 125;
      running.ingestTelemetry({ ...simulatedFrame(timestamp), timestamp, lap: 2, lapDistance: index / 899, gamePhase: 5, sessionTimeRemainingSeconds: 300 });
      if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 1));
    }
    running.ingestTelemetry({ ...simulatedFrame(2_113_000), timestamp: 2_113_000, lap: 3, lapDistance: .02, gamePhase: 8, sessionTimeRemainingSeconds: 0, inPits: true });
    await new Promise(resolve => setTimeout(resolve, 200));
    const sessions = await fetch(`http://127.0.0.1:${running.port}/api/sessions`).then(response => response.json()) as Array<{ laps: unknown[] }>;
    assert.equal(sessions.length, 1);
  } finally { await running.close(); }
});

test("manual stop stays paused until a new LMU session and then rearms", async () => {
  process.env.KYNOLITH_DESKTOP = "1";
  const { startCoachServer } = await import("./server.js");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "apex-manual-stop-"));
  const running = await startCoachServer({ port: 0, publicDir: path.resolve("public"), dataDir });
  const base = `http://127.0.0.1:${running.port}`;
  const pushFrames = async (session: "practice" | "qualifying", start: number) => {
    for (let index = 0; index < 80; index++) {
      running.ingestTelemetry({ ...simulatedFrame(start + index * 500), timestamp: start + index * 500, session, lap: 2, lapDistance: index / 79, gamePhase: 5, sessionTimeRemainingSeconds: 300 });
      if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 1));
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  };
  try {
    await pushFrames("practice", 3_000_000);
    const stopped = await fetch(`${base}/api/session/stop`, { method: "POST" });
    assert.equal(stopped.status, 200);
    await pushFrames("practice", 3_100_000);
    let sessions = await fetch(`${base}/api/sessions`).then(response => response.json()) as unknown[];
    assert.equal(sessions.length, 1);
    await pushFrames("qualifying", 3_200_000);
    running.ingestTelemetry({ ...simulatedFrame(3_241_000), timestamp: 3_241_000, session: "qualifying", gamePhase: 8, sessionTimeRemainingSeconds: 0, inPits: true });
    await new Promise(resolve => setTimeout(resolve, 150));
    sessions = await fetch(`${base}/api/sessions`).then(response => response.json()) as unknown[];
    assert.equal(sessions.length, 2);
  } finally { await running.close(); }
});
