import path from "node:path";
import { LocalAi } from "../src/local-ai.js";
import { simulatedFrame } from "../src/simulator.js";
import type { CoachState } from "../src/types.js";

const ai = new LocalAi(path.resolve(".model-smoke-cache"));
try {
  const transcript = await ai.transcribe(new Float32Array(16_000));
  await ai.warmup();
  const state: CoachState = { connected: true, source: "simulator", frame: simulatedFrame(), lastCue: null, bestLapSeconds: null, lastLapSeconds: null, consistencySeconds: null };
  const answer = await ai.answer("Why does the nose skate wide at the center of the bend?", state, null);
  console.log(JSON.stringify({ transcriptionReady: typeof transcript === "string", generationReady: answer.length > 0, answer }));
} finally { await ai.dispose(); }
