import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startCoachServer } from "./server.js";
import { SessionRecorder } from "./session-recorder.js";
import { simulatedFrame } from "./simulator.js";

test("POST /api/profile/reset clears persisted and active driver history", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apex-profile-reset-"));
  const sessionsDir = path.join(tmp, "sessions");

  const seed = new SessionRecorder(sessionsDir);
  await seed.initialize();

  for (let i = 0; i < 220; i++) {
    const timestamp = 100_000 + i * 500;

    await seed.recordFrame({
      ...simulatedFrame(timestamp),
      timestamp,
      lap: Math.floor(i / 100) + 1,
      lapDistance: (i % 100) / 100
    });
  }

  // Persist the seeded session before the server creates its own recorder.
  await seed.finish();

  const server = await startCoachServer({
    port: 0,
    publicDir: path.resolve("public"),
    dataDir: tmp,
    allowModelDownloads: false,
    prewarmVoices: false
  });

  try {
    const beforeSessions = await fetch(
      `http://127.0.0.1:${server.port}/api/sessions`
    ).then(response => response.json());

    assert.equal(beforeSessions.length, 1);

    const beforeProfile = await fetch(
      `http://127.0.0.1:${server.port}/api/profile`
    ).then(response => response.json());

    assert.equal(beforeProfile.dataQuality.totalSessions, 1);

    // Create an active recording owned by the server recorder.
    for (let i = 0; i < 40; i++) {
      const timestamp = 500_000 + i * 100;

      server.ingestTelemetry({
        ...simulatedFrame(timestamp),
        timestamp,
        lap: 1,
        lapDistance: i / 100
      });
    }

    const reset = await fetch(
      `http://127.0.0.1:${server.port}/api/profile/reset`,
      { method: "POST" }
    );

    assert.equal(reset.status, 204);

    const afterSessions = await fetch(
      `http://127.0.0.1:${server.port}/api/sessions`
    ).then(response => response.json());

    assert.deepEqual(afterSessions, []);

    const afterProfile = await fetch(
      `http://127.0.0.1:${server.port}/api/profile`
    ).then(response => response.json());

    assert.equal(afterProfile.score, null);
    assert.equal(afterProfile.trend, "new");
    assert.equal(afterProfile.level, "Rookie");
    assert.equal(afterProfile.sessions, 0);
    assert.equal(afterProfile.completedLaps, 0);
    assert.equal(afterProfile.dataQuality.totalSessions, 0);
    assert.equal(afterProfile.academy.rank, "Rookie");
    assert.equal(afterProfile.academy.curriculumLevel, 0);
  } finally {
    await server.close();
  }

  // Closing the server must not resurrect the active recording
  // that existed before the reset.
  const verification = new SessionRecorder(sessionsDir);
  await verification.initialize();

  assert.deepEqual(await verification.list(), []);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
});
