import express from "express";
import { createServer, type Server } from "node:http";
import path from "node:path";
import os from "node:os";
import { WebSocketServer } from "ws";
import { CoachingEngine } from "./coaching.js";
import { CueScheduler } from "./cue-scheduler.js";
import { simulatedFrame } from "./simulator.js";
import { LocalAi } from "./local-ai.js";
import { SessionRecorder } from "./session-recorder.js";
import { SettingsStore, spacingFor } from "./settings.js";
import { buildDriverProfile } from "./driver-profile.js";
import { analyzeSessionIntelligence } from "./track-intelligence.js";
import { ReferenceStore } from "./reference-store.js";
import type { CoachState, TelemetryFrame } from "./types.js";

export interface CoachServerOptions {
  port?: number;
  publicDir?: string;
  dataDir?: string;
  bundledModelsDir?: string;
  allowModelDownloads?: boolean;
}

export interface RunningCoachServer {
  port: number;
  close: () => Promise<void>;
}

export async function startCoachServer(options: CoachServerOptions = {}): Promise<RunningCoachServer> {
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });
const engine = new CoachingEngine();
const scheduler = new CueScheduler();
const dataDir = options.dataDir ?? path.resolve("data");
const recorder = new SessionRecorder(path.join(dataDir, "sessions"));
await recorder.initialize();
const references = new ReferenceStore(path.join(dataDir, "references"));
await references.initialize();
const settings = new SettingsStore(path.join(dataDir, "settings.json"));
await settings.initialize();
scheduler.setMinimumSpacing(spacingFor(settings.get().speechFrequency));
engine.setInstructionMode(settings.get().speechFrequency);
const localAi = new LocalAi(path.join(dataDir, "models"), {
  ...(options.bundledModelsDir ? { bundledModelsDirectory: options.bundledModelsDir } : {}),
  ...(options.allowModelDownloads === undefined ? {} : { allowModelDownloads: options.allowModelDownloads })
});
let welcomedSessionKey = "";
let neuralSpeechBusy = false;
let lastStrongLanguageAt = 0;
const state: CoachState = { connected: true, source: "simulator", frame: null, lastCue: null, bestLapSeconds: null, lastLapSeconds: null, consistencySeconds: null };

app.use(express.json({ limit: "25mb" }));
app.use(express.static(options.publicDir ?? path.resolve("public")));
app.get("/api/state", (_req, res) => res.json(state));
app.get("/api/settings", (_req, res) => res.json(settings.get()));
app.put("/api/settings", async (req, res) => {
  try {
    const next = await settings.update(req.body ?? {});
    scheduler.setMinimumSpacing(spacingFor(next.speechFrequency));
    engine.setInstructionMode(next.speechFrequency);
    res.json(next);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid settings" }); }
});
app.get("/api/local/status", (_req, res) => {
  const status = localAi.status();
  const delivery = status.delivery === "bundled-offline" ? "bundled offline" : status.modelDownloadsAllowed ? "local after one-time download" : "local cache only";
  res.json({
    speechRecognition: `${status.speechModel} (${delivery})`,
    coachModel: `${status.coachModel} (${delivery})`,
    speechOutput: `Kokoro 82M neural voice (${delivery}); Windows voice fallback`,
    cacheDirectory: status.cacheDirectory
  });
});
app.post("/api/telemetry", (req, res) => {
  const frame = req.body as TelemetryFrame;
  if (!Number.isFinite(frame.timestamp) || !Number.isFinite(frame.speedKph)) return res.status(400).json({ error: "Invalid telemetry frame" });
  state.connected = true; state.source = "lmu"; processFrame(frame); res.sendStatus(204);
});
app.post("/api/telemetry/disconnect", (_req, res) => {
  state.connected = false;
  state.source = "simulator";
  void recorder.finish();
  res.sendStatus(204);
});
app.get("/api/sessions", async (_req, res) => res.json(await recorder.list()));
app.get("/api/profile", async (_req, res) => res.json(buildDriverProfile(settings.get().driverName, await recorder.list())));
app.get("/api/sessions/:id", async (req, res) => {
  const session = await recorder.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const personal = selectPersonalBest(await recorder.comparable(session.summary.track, session.summary.vehicle));
  const expert = await references.matching(session.summary.track, session.summary.vehicle);
  res.json({ ...session, intelligence: analyzeSessionIntelligence(session, personal, expert) });
});
app.get("/api/references", async (_req, res) => res.json(await references.list()));
app.post("/api/references/import", async (req, res) => {
  try { res.status(201).json(await references.import(req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid reference" }); }
});
app.post("/api/local/transcribe", express.raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.byteLength < 6400 || buffer.byteLength % 4 !== 0) return res.status(400).json({ error: "Invalid PCM audio" });
    const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    res.json({ text: await localAi.transcribe(new Float32Array(copy), settings.get().inputSensitivity) });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Transcription failed" }); }
});
app.post("/api/local/ask", async (req, res) => {
  try {
    const question = String(req.body?.question ?? "").trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: "Question is required" });
    const latest = (await recorder.list())[0] ?? null;
    const answer = await localAi.answer(question, state, latest);
    const config = settings.get();
    res.json({ answer: personalize(applyTemper(answer, config.swearingLevel, question), config.driverName) });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Local coach failed" }); }
});
app.post("/api/local/speak", async (req, res) => {
  try {
    if (neuralSpeechBusy) return res.status(429).json({ error: "Neural voice busy; use immediate system fallback" });
    if (os.freemem() < 4 * 1024 ** 3) return res.status(503).json({ error: "Memory guard enabled; use system voice fallback" });
    const text = String(req.body?.text ?? "").trim().slice(0, 600);
    if (!text) return res.status(400).json({ error: "Speech text is required" });
    const voice = String(req.body?.voice ?? "af_heart").slice(0, 40);
    const speed = Number(req.body?.speed ?? 1);
    neuralSpeechBusy = true;
    const wav = await localAi.synthesize(text, voice, Number.isFinite(speed) ? speed : 1);
    res.type("audio/wav").send(Buffer.from(wav));
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Neural speech failed" }); }
  finally { neuralSpeechBusy = false; }
});
async function processFrame(frame: TelemetryFrame): Promise<void> {
  state.frame = frame;
  if (state.source === "lmu") await recorder.recordFrame(frame);
  const sessionKey = `${frame.track}|${frame.vehicle}|${frame.session}`;
  if (state.source === "lmu" && sessionKey !== welcomedSessionKey) {
    welcomedSessionKey = sessionKey;
    const name = settings.get().driverName;
    const academy = buildDriverProfile(name, await recorder.list()).academy;
    scheduler.enqueue([{
      id: `welcome-${frame.timestamp}`, at: frame.timestamp, priority: "info", category: "lap",
      message: name ? `${name}, today's drill: ${academy.drill.name}. Build into it.` : `Today's drill: ${academy.drill.name}. Build into it.`,
      speak: true, expiresAt: frame.timestamp + 15_000, delayInHardPart: true
    }]);
  }
  scheduler.enqueue(engine.ingest(frame));
  const cue = scheduler.next(frame);
  if (cue) {
    const config = settings.get();
    if (cue.priority === "technique") {
      let level = config.swearingLevel;
      if (level === 3 && frame.timestamp - lastStrongLanguageAt < 45_000) level = 2;
      else if (level === 3) lastStrongLanguageAt = frame.timestamp;
      const cornerCall = cue.id.startsWith("corner-review") || cue.id.startsWith("corner-clean");
      if (!cornerCall) cue.message = applyTemper(cue.message, level, cue.id, cue.id.startsWith("clean-exit"));
    }
    if (config.driverName && cue.priority === "technique" && shouldUseName(cue.id, frame.lap)) cue.message = personalize(cue.message, config.driverName);
    cue.speak = state.source === "lmu" && config.autoSpeak && allowedToSpeak(cue, config);
    state.lastCue = cue; if (state.source === "lmu") recorder.recordCue(cue, frame);
  }
  const payload = JSON.stringify({ type: "state", state, cue: cue ?? null });
  for (const client of wss.clients) if (client.readyState === 1) client.send(payload);
}

function allowedToSpeak(cue: { priority: string; category: string }, config: ReturnType<SettingsStore["get"]>): boolean {
  if (cue.category === "safety") return config.speakSafety;
  if (cue.category === "racecraft") return config.speakRace;
  if (cue.priority === "technique") return config.speakTechnique;
  return config.speakInfo;
}

function personalize(message: string, driverName: string): string {
  if (!driverName) return message;
  return `${driverName}, ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

function shouldUseName(cueId: string, lap: number): boolean {
  return (cueId.length + lap) % 3 === 0;
}

function applyTemper(message: string, level: number, seed: string, positive = false): string {
  if (level <= 0) return message;
  if (positive) return level >= 2 ? `That's more like it. ${message}` : message;
  const choices = level === 1
    ? ["Come on, ", "Let's sharpen it up—"]
    : level === 2
      ? ["Damn it, ", "Come on, wake it up—"]
      : ["For fuck's sake, ", "Damn it, ", "Stop throwing the damn corner away—", "Wake up and drive the thing—"];
  const prefix = choices[hash(seed) % choices.length] ?? choices[0] ?? "";
  return `${prefix}${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

function selectPersonalBest(sessions: import("./types.js").RecordedSession[]): { label: string; lapTimeSeconds: number; frames: TelemetryFrame[] } | null {
  let best: { label: string; lapTimeSeconds: number; frames: TelemetryFrame[] } | null = null;
  for (const session of sessions) for (const lap of session.summary.laps.filter(item => item.complete && item.durationSeconds > 20)) {
    if (best && lap.durationSeconds >= best.lapTimeSeconds) continue;
    const frames = session.frames.filter(frame => frame.lap === lap.lap);
    if (frames.length >= 20) best = { label: `Personal best ${formatLap(lap.durationSeconds)}`, lapTimeSeconds: lap.durationSeconds, frames };
  }
  return best;
}

function formatLap(seconds: number): string { const minutes = Math.floor(seconds / 60); return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`; }

function hash(value: string): number { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }

const simulatorTimer = setInterval(() => { if (state.source === "simulator") void processFrame(simulatedFrame()); }, 100);
wss.on("connection", socket => socket.send(JSON.stringify({ type: "state", state })));
const requestedPort = options.port ?? Number(process.env.PORT ?? 4377);
await listen(server, requestedPort);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Coach server did not bind to TCP");
return {
  port: address.port,
  close: async () => {
    clearInterval(simulatorTimer);
    await recorder.finish();
    await localAi.dispose();
    for (const socket of wss.clients) socket.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
};
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
}

if (process.env.KYNOLITH_DESKTOP !== "1") {
  startCoachServer().then(running => console.log(`Kynolith LMU Coach: http://127.0.0.1:${running.port}`)).catch(error => {
    console.error(error); process.exitCode = 1;
  });
}
