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
