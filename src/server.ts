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
import { TrackModelStore } from "./track-model-store.js";
import { applyRowdyCorner, applyTemper } from "./coach-personality.js";
import { BoundedFramePipeline, type PipelineMetrics } from "./bounded-frame-pipeline.js";
import { MINIMUM_CALIBRATION_LABELS, ScoreCalibrationStore, type ExpertLabel } from "./score-calibration.js";
import { convertReferenceFile } from "./reference-converter.js";
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
  ingestTelemetry: (frame: TelemetryFrame) => boolean;
  disconnectTelemetry: () => Promise<void>;
  telemetryMetrics: () => PipelineMetrics;
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
const trackModels = new TrackModelStore(path.join(dataDir, "track-models"));
await trackModels.initialize();
const settings = new SettingsStore(path.join(dataDir, "settings.json"));
await settings.initialize();
const calibration = new ScoreCalibrationStore(path.join(dataDir, "score-calibration.json"));
await calibration.initialize();
scheduler.setMinimumSpacing(spacingFor(settings.get().speechFrequency));
scheduler.setTechniquePolicy(settings.get().speechFrequency);
engine.setInstructionMode(settings.get().speechFrequency);
const localAi = new LocalAi(path.join(dataDir, "models"), {
  ...(options.bundledModelsDir ? { bundledModelsDirectory: options.bundledModelsDir } : {}),
  ...(options.allowModelDownloads === undefined ? {} : { allowModelDownloads: options.allowModelDownloads })
});
let welcomedSessionKey = "";
let terminalSession = false;
let manuallyStoppedSessionKey = "";
let manualStopSawTerminal = false;
let neuralSpeechBusy = false;
let lastStrongLanguageAt = 0;
let cachedAcademy = buildDriverProfile(settings.get().driverName, await recorder.list(), calibration.get()).academy;
const state: CoachState = { connected: false, source: "simulator", sessionActive: false, frame: null, lastCue: null, bestLapSeconds: null, lastLapSeconds: null, consistencySeconds: null };
const telemetryPipeline = new BoundedFramePipeline<TelemetryFrame>(12, processFrame, 180);
const acceptTelemetry = (frame: TelemetryFrame): boolean => { state.connected = true; state.source = "lmu"; return telemetryPipeline.push(frame); };

app.use(express.json({ limit: "25mb" }));
app.use(express.static(options.publicDir ?? path.resolve("public")));
app.get("/api/state", (_req, res) => res.json(state));
app.get("/api/telemetry/health", (_req, res) => res.json(telemetryPipeline.snapshot()));
app.get("/api/settings", (_req, res) => res.json(settings.get()));
app.put("/api/settings", async (req, res) => {
  try {
    const next = await settings.update(req.body ?? {});
    scheduler.setMinimumSpacing(spacingFor(next.speechFrequency));
    scheduler.setTechniquePolicy(next.speechFrequency);
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
  if (!acceptTelemetry(frame)) return res.status(409).json({ error: "Telemetry frame rejected" });
  res.sendStatus(202);
});
app.post("/api/telemetry/disconnect", async (_req, res) => {
  await telemetryPipeline.idle();
  state.connected = false;
  state.source = "simulator";
  state.sessionActive = false;
  await recorder.finish();
  res.sendStatus(204);
});
app.post("/api/session/stop", async (_req, res) => {
  await telemetryPipeline.idle();
  const frame = state.frame;
  manuallyStoppedSessionKey = frame ? sessionKeyFor(frame) : "manual-stop";
  manualStopSawTerminal = false;
  state.sessionActive = false;
  scheduler.clear();
  const summary = await recorder.finish();
  res.json({ stopped: true, summary });
});
app.get("/api/sessions", async (_req, res) => res.json(await recorder.list()));
app.get("/api/profile", async (_req, res) => res.json(buildDriverProfile(settings.get().driverName, await recorder.list(), calibration.get())));
app.get("/api/calibration", (_req, res) => res.json(calibration.get() ?? { status: "uncalibrated", minimumExpertLabels: MINIMUM_CALIBRATION_LABELS, validatedExpertLabels: 30 }));
app.post("/api/calibration/import", async (req, res) => {
  try { res.status(201).json(await calibration.import((req.body?.labels ?? []) as ExpertLabel[])); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid calibration labels" }); }
});
app.get("/api/sessions/:id", async (req, res) => {
  const session = await recorder.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const personal = selectPersonalBest(await recorder.comparable(session.summary.track, session.summary.vehicle));
  const expert = await references.matching(session.summary.track, session.summary.vehicle);
  const model = await trackModels.resolve(session);
  const profile = buildDriverProfile(settings.get().driverName, await recorder.list(), calibration.get());
  res.json({ ...session, intelligence: analyzeSessionIntelligence(session, personal, expert, model, profile.academy.rank) });
});
app.get("/api/references", async (_req, res) => res.json(await references.list()));
app.post("/api/references/import", async (req, res) => {
  try { res.status(201).json(await references.import(req.body)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid reference" }); }
});
app.post("/api/references/import-file", express.raw({ type: "application/octet-stream", limit: "256mb" }), async (req, res) => {
  try {
    const filename = decodeURIComponent(String(req.header("x-apex-filename") ?? "reference")).slice(0, 180);
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return res.status(400).json({ error: "Reference file is empty" });
    res.status(201).json(await references.import(await convertReferenceFile(filename, buffer)));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Reference conversion failed" }); }
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
    const sessionAnswer = latest ? await answerSessionQuestion(question, latest.id) : null;
    const answer = sessionAnswer ?? await localAi.answer(question, state, latest);
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
app.post("/api/audio/delivery", (req, res) => {
  const cueId = String(req.body?.cueId ?? "").slice(0, 160);
  const requestToPlaybackMs = Number(req.body?.requestToPlaybackMs);
  const telemetryToPlaybackMs = req.body?.telemetryToPlaybackMs == null ? null : Number(req.body.telemetryToPlaybackMs);
  const engineName = req.body?.engine === "neural" ? "neural" : "system";
  if (!cueId || !Number.isFinite(requestToPlaybackMs)) return res.status(400).json({ error: "Invalid audio delivery metric" });
  res.status(recorder.recordAudioDelivery(cueId, requestToPlaybackMs, telemetryToPlaybackMs, engineName) ? 202 : 404).end();
});
async function processFrame(frame: TelemetryFrame): Promise<void> {
  state.frame = frame;
  const sessionKey = sessionKeyFor(frame);
  const sessionTerminal = (frame.gamePhase ?? 0) >= 8 || (frame.sessionTimeRemainingSeconds === 0 && frame.inPits);
  if (state.source === "lmu" && sessionTerminal) {
    state.sessionActive = false;
    if (manuallyStoppedSessionKey) manualStopSawTerminal = true;
    if (!terminalSession) { terminalSession = true; scheduler.clear(); await recorder.finish(); welcomedSessionKey = ""; }
    broadcast(null);
    return;
  }
  const supportedSession = frame.session === "practice" || frame.session === "qualifying" || frame.session === "race";
  const shouldRearm = Boolean(manuallyStoppedSessionKey) && supportedSession && (sessionKey !== manuallyStoppedSessionKey || manualStopSawTerminal);
  if (shouldRearm) { manuallyStoppedSessionKey = ""; manualStopSawTerminal = false; }
  if (terminalSession) { terminalSession = false; cachedAcademy = buildDriverProfile(settings.get().driverName, await recorder.list(), calibration.get()).academy; }
  if (!supportedSession || manuallyStoppedSessionKey) { state.sessionActive = false; broadcast(null); return; }
  state.sessionActive = state.source === "lmu";
  if (state.source === "lmu") await recorder.recordFrame(frame);
  if (state.source === "lmu" && sessionKey !== welcomedSessionKey) {
    welcomedSessionKey = sessionKey;
    const name = settings.get().driverName;
    engine.setCurriculumLevel(cachedAcademy.curriculumLevel);
    scheduler.enqueue([{
      id: `welcome-${frame.timestamp}`, at: frame.timestamp, priority: "info", category: "lap",
      message: name ? `${name}, today's drill: ${cachedAcademy.drill.name}. Build into it.` : `Today's drill: ${cachedAcademy.drill.name}. Build into it.`,
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
      const positive = cue.id.startsWith("corner-clean") || cue.id.startsWith("clean-exit");
      if (cornerCall && level === 4) cue.message = applyRowdyCorner(cue.message, positive, cue.id);
      else if (!cornerCall) cue.message = applyTemper(cue.message, level, cue.id, positive);
    }
    if (config.driverName && cue.priority === "technique" && shouldUseName(cue.id, frame.lap)) cue.message = personalize(cue.message, config.driverName);
    cue.speak = state.source === "lmu" && config.autoSpeak && allowedToSpeak(cue, config);
    state.lastCue = cue; if (state.source === "lmu") recorder.recordCue(cue, frame);
  }
  broadcast(cue ?? null);
}

function broadcast(cue: import("./types.js").CoachingCue | null): void {
  const payload = JSON.stringify({ type: "state", state, cue });
  for (const client of wss.clients) if (client.readyState === 1) client.send(payload);
}

function sessionKeyFor(frame: TelemetryFrame): string { return `${frame.track}|${frame.vehicle}|${frame.session}`; }

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

async function answerSessionQuestion(question: string, sessionId: string): Promise<string | null> {
  const q = question.toLowerCase();
  if (!/where.*(losing|lose).*time|worst corner|technique score|current drill|what.*focus/.test(q)) return null;
  const session = await recorder.get(sessionId); if (!session) return null;
  const personal = selectPersonalBest(await recorder.comparable(session.summary.track, session.summary.vehicle));
  const expert = await references.matching(session.summary.track, session.summary.vehicle);
  const model = await trackModels.resolve(session);
  const profile = buildDriverProfile(settings.get().driverName, await recorder.list(), calibration.get());
  const intelligence = analyzeSessionIntelligence(session, personal, expert, model, profile.academy.rank);
  const drill = intelligence.curriculum.focusedDrill;
  if (/technique score/.test(q)) {
    const score = intelligence.curriculum.technique;
    return `Trail braking ${score.trailBrake}, steering efficiency ${score.steeringEfficiency}, and throttle squeeze ${score.throttleSqueeze} out of 100.`;
  }
  if (/current drill|what.*focus/.test(q)) return drill?.instruction ?? profile.academy.drill.instructions;
  return drill ? `Your largest repeatable loss is ${drill.averageLossSeconds.toFixed(2)} seconds at ${drill.corner}. Focus there and target recovering ${drill.recoveryTargetSeconds.toFixed(2)} seconds.` : "I do not see a repeatable corner loss yet. Build another clean reference lap.";
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

const simulatorTimer = setInterval(() => { if (state.source === "simulator") void processFrame(simulatedFrame()); }, 100);
wss.on("connection", socket => socket.send(JSON.stringify({ type: "state", state })));
const requestedPort = options.port ?? Number(process.env.PORT ?? 4377);
await listen(server, requestedPort);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Coach server did not bind to TCP");
return {
  port: address.port,
  ingestTelemetry: acceptTelemetry,
  telemetryMetrics: () => telemetryPipeline.snapshot(),
  disconnectTelemetry: async () => { await telemetryPipeline.idle(); state.connected = false; state.source = "simulator"; state.sessionActive = false; await recorder.finish(); },
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
