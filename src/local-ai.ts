import { existsSync } from "node:fs";
import path from "node:path";
import { LMU_KNOWLEDGE, selectLmuKnowledge, type LmuKnowledgeCard } from "./lmu-knowledge.js";
import type { CoachState, SessionSummary } from "./types.js";
import { directSpeech, roleSpeed, type SpeechEmotion, type SpeechRole } from "./prosody-director.js";

const SPEECH_MODEL = "onnx-community/whisper-tiny.en";
const COACH_MODEL = "onnx-community/Qwen3-0.6B-ONNX";
const VOICE_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICES = new Set(["am_fenrir", "am_michael", "af_heart", "af_bella"]);

export interface LocalAiOptions {
  bundledModelsDirectory?: string;
  allowModelDownloads?: boolean;
}
export interface LocalAiStatus {
  speechModel: string;
  coachModel: string;
  delivery: "bundled-offline" | "managed-local-cache";
  modelDownloadsAllowed: boolean;
  cacheDirectory: string;
}

export class LocalAi {
  private transcriber: any;
  private generator: any;
  private synthesizer: any;
  private loadingTranscriber?: Promise<any>;
  private loadingGenerator?: Promise<any>;
  private loadingSynthesizer?: Promise<any>;
  private readonly options: LocalAiOptions;

  constructor(private readonly cacheDirectory: string, options: LocalAiOptions = {}) {
    this.options = options;
  }

  status(): LocalAiStatus {
    const bundled = this.hasCompleteBundle();
    return {
      speechModel: "Whisper Tiny English Q8",
      coachModel: "Qwen3 0.6B Q4 guarded LMU router",
      delivery: bundled ? "bundled-offline" : "managed-local-cache",
      modelDownloadsAllowed: !bundled && (this.options.allowModelDownloads ?? true),
      cacheDirectory: bundled ? this.options.bundledModelsDirectory! : path.join(this.cacheDirectory, "huggingface")
    };
  }

  async transcribe(audio: Float32Array, microphoneGain = 6): Promise<string> {
    const pipe = await this.getTranscriber();
    const result = await pipe(normalizeMicrophoneAudio(audio, microphoneGain));
    return String(Array.isArray(result) ? result[0]?.text ?? "" : result?.text ?? "").trim();
  }

  async warmup(): Promise<void> {
    await this.getTranscriber();
    await this.getGenerator();
  }

  async synthesize(text: string, voice = "af_heart", speed = 1, role: SpeechRole = "coach", emotion: SpeechEmotion = "calm"): Promise<ArrayBuffer> {
    const synthesizer = await this.getSynthesizer();
    const selectedVoice = KOKORO_VOICES.has(voice) ? voice : "af_heart";
    const audio = await synthesizer.generate(directSpeech(text, role, emotion), {
      voice: selectedVoice,
      speed: roleSpeed(speed, role, emotion)
    });
    return audio.toWav();
  }

  async answer(question: string, state: CoachState, recentSession: SessionSummary | null): Promise<string> {
    const deterministic = answerTelemetryQuestion(question, state);
    if (deterministic) return deterministic;
    const verifiedKnowledge = selectLmuKnowledge(question, 1)[0];
    if (verifiedKnowledge) return cleanRadioAnswer(verifiedKnowledge.guidance);
    const routedKnowledge = await this.routeKnowledge(question);
    if (routedKnowledge) return cleanRadioAnswer(routedKnowledge.guidance);
    void recentSession;
    return "Apex does not have verified LMU guidance for that question yet. Ask about live telemetry, driving technique, setup, tires, braking, traction control, energy, or strategy.";
  }

  async dispose(): Promise<void> {
    await this.transcriber?.dispose?.(); await this.generator?.dispose?.();
    await this.synthesizer?.model?.dispose?.();
    this.transcriber = undefined; this.generator = undefined; this.synthesizer = undefined;
  }

  private async configure(): Promise<typeof import("@huggingface/transformers")> {
    const transformers = await import("@huggingface/transformers");
    transformers.env.cacheDir = path.join(this.cacheDirectory, "huggingface");
    transformers.env.useFSCache = true;
    if (this.hasCompleteBundle()) {
      transformers.env.localModelPath = this.options.bundledModelsDirectory!;
      transformers.env.allowRemoteModels = false;
    } else {
      transformers.env.allowRemoteModels = this.options.allowModelDownloads ?? true;
      if (!transformers.env.allowRemoteModels) {
        throw new Error("Apex offline models are not installed. Stage the model bundle before building or enable the one-time local model download.");
      }
    }
    return transformers;
  }

  private async getTranscriber(): Promise<any> {
    if (this.transcriber) return this.transcriber;
    this.loadingTranscriber ??= this.configure().then(async ({ pipeline }) => {
      this.transcriber = await pipeline("automatic-speech-recognition", SPEECH_MODEL, { dtype: "q8" });
      return this.transcriber;
    });
    return this.loadingTranscriber;
  }

  private async getGenerator(): Promise<any> {
    if (this.generator) return this.generator;
    this.loadingGenerator ??= this.configure().then(async ({ pipeline }) => {
      this.generator = await pipeline("text-generation", COACH_MODEL, { dtype: "q4" });
      return this.generator;
    });
    return this.loadingGenerator;
  }

  private async getSynthesizer(): Promise<any> {
    if (this.synthesizer) return this.synthesizer;
    this.loadingSynthesizer ??= this.configure().then(async () => {
      const { KokoroTTS } = await import("kokoro-js");
      this.synthesizer = await KokoroTTS.from_pretrained(VOICE_MODEL, { dtype: "q8", device: "cpu" });
      return this.synthesizer;
    });
    return this.loadingSynthesizer;
  }

  private async routeKnowledge(question: string): Promise<LmuKnowledgeCard | null> {
    const generator = await this.getGenerator();
    const catalog = LMU_KNOWLEDGE.map(card => `${card.id}: ${card.title}`).join("\n");
    const messages = [
      { role: "system", content: "Classify the driver's Le Mans Ultimate question. Return exactly one catalog id, or unknown when no category clearly applies. Never answer the question." },
      { role: "user", content: `CATALOG\n${catalog}\n\nQUESTION\n${question}\n\nReturn one id only. /no_think` }
    ];
    const output = await generator(messages, { max_new_tokens: 16, do_sample: false });
    const generated = output?.[0]?.generated_text;
    const value = Array.isArray(generated) ? generated.at(-1)?.content : generated;
    const normalized = String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9-]+/g, " ").trim();
    if (normalized === "unknown" || normalized.includes(" unknown ")) return null;
    return LMU_KNOWLEDGE.find(card => normalized.split(/\s+/).includes(card.id)) ?? null;
  }

  private hasCompleteBundle(): boolean {
    const root = this.options.bundledModelsDirectory;
    if (!root) return false;
    return [
      path.join(root, SPEECH_MODEL, "config.json"),
      path.join(root, SPEECH_MODEL, "onnx", "encoder_model_quantized.onnx"),
      path.join(root, SPEECH_MODEL, "onnx", "decoder_model_merged_quantized.onnx"),
      path.join(root, COACH_MODEL, "config.json"),
      path.join(root, COACH_MODEL, "onnx", "model_q4.onnx"),
      path.join(root, VOICE_MODEL, "config.json"),
      path.join(root, VOICE_MODEL, "onnx", "model_quantized.onnx"),
      path.join(root, VOICE_MODEL, "voices", "af_heart.bin")
    ].every(file => existsSync(file));
  }
}

function normalizeMicrophoneAudio(audio: Float32Array, microphoneGain: number): Float32Array {
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  if (peak < .00005) return audio;
  const gain = Math.min(Math.max(1, Math.min(20, microphoneGain)), .92 / peak), output = new Float32Array(audio.length);
  for (let index = 0; index < audio.length; index++) output[index] = Math.max(-1, Math.min(1, (audio[index] ?? 0) * gain));
  return output;
}

function answerTelemetryQuestion(question: string, state: CoachState): string | null {
  const q = question.toLowerCase();
  if (/\b(are you ready|you ready|are you there|can you hear me|apex.*ready|apex.*there)\b/.test(q)) {
    return state.source === "lmu" && state.connected
      ? "I'm here, I can hear you, and LMU telemetry is live. Let's get to work."
      : "I'm here and I can hear you. Start or enter the LMU session and I'll confirm when telemetry comes online.";
  }
  if (/\bthank(s| you)\b/.test(q)) return "You've got it. Keep your eyes up and stay with the next reference point.";
  const frame = state.frame; if (!frame) return null;
  if (/\bfuel\b|\bhow much gas\b|\bgas remaining\b/.test(q)) return `You have ${(frame.fuelLiters * 0.264172).toFixed(1)} gallons remaining.`;
  if (/speed|fast/.test(q)) return `Current speed is ${Math.round(frame.speedKph * 0.621371)} miles per hour.`;
  if (/position|place/.test(q)) return `You are P${frame.position} overall and P${frame.classPosition} in class.`;
  if (/tire|tyre|pressure/.test(q)) return `Tire pressures are ${frame.tirePressurePsi.map(value => value.toFixed(1)).join(", ")} PSI.`;
  if (/temperature|temps/.test(q)) return `Tire temperatures are ${frame.tireTempC.map(value => Math.round(value * 9 / 5 + 32)).join(", ")} degrees Fahrenheit.`;
  if (/gap|ahead/.test(q) && frame.gapAheadSeconds !== null) return `The gap ahead is ${frame.gapAheadSeconds.toFixed(1)} seconds.`;
  if (/brake migration/.test(q)) return "Brake migration changes the front-to-rear brake balance through the braking phase, so you can tune straight-line stability separately from rotation during release. Change it one step at a time and compare both phases over repeatable laps.";
  if (/virtual energy|\bnrg\b/.test(q)) return "LMU virtual energy is the stint energy allowance, which is separate from the hybrid battery state of charge. Project it from multiple green-flag laps and include traffic, lift-and-coast, and the remaining stint.";
  if (/traction control|\btc\b|power cut|slip angle/.test(q)) return "LMU separates traction-control intervention, power cut, and slip-angle control. Identify whether the loss is wheelspin, excessive yaw, or an intervention that is cutting acceleration before changing one control.";
  if (/\babs\b/.test(q)) return "LMGT3 ABS activity can come from excessive pedal demand, bumps unloading a tire, or the selected ABS level. Stabilize the braking trace first, then test one setting change over comparable laps.";
  if (/corner exit|exit speed|power down/.test(q)) return "Open your hands as you pass the apex, then squeeze the throttle in proportion to the steering you remove.";
  if (/apex|patien/.test(q)) return "Patience at the apex prevents you from adding throttle while the tires are still carrying maximum cornering load. Unwind the wheel first, then accelerate.";
  if (/trail brak|brake release/.test(q)) return "Trail braking means easing off the brake as you add steering, keeping light front-tire load toward the apex.";
  if (/weight transfer|load transfer/.test(q)) return "Weight transfer is the tire-load shift caused by braking, acceleration, and cornering. Make each input progressive so the tires gain or lose load smoothly instead of being shocked past their grip.";
  if (/brake later|braking point/.test(q)) return "Prioritize a repeatable brake marker and clean release before moving the braking point later.";
  if (/understeer|won't turn|will not turn/.test(q)) return "Reduce entry speed and release the brake more progressively; adding steering usually creates more front-tire scrub.";
  if (/oversteer|rear.*slide|loose/.test(q)) return "Reduce the rate of throttle application and unwind steering earlier; avoid abrupt corrections that start a second slide.";
  if (/consistent|consistency/.test(q)) return "Use the same brake marker, initial pressure, and turn-in point for three laps before changing one variable.";
  return null;
}

function cleanRadioAnswer(value: string): string {
  const cleaned = value.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\s+/g, " ").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
  const answer = sentences.slice(0, 2).join(" ").slice(0, 360).trim();
  if (!answer) return "Apex needs more comparable LMU telemetry before recommending a change.";
  return /[.!?]$/.test(answer) ? answer : `${answer}.`;
}
