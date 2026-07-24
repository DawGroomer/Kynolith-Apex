import fs from "node:fs/promises";
import path from "node:path";

export type SpeechFrequency = "quiet" | "balanced" | "active";
export interface CoachSettings {
  driverName: string;
  swearingLevel: number;
  voiceEngine: "neural" | "system";
  neuralVoice: "am_fenrir" | "am_michael" | "af_heart" | "af_bella";
  spotterVoice: "am_fenrir" | "am_michael" | "af_heart" | "af_bella";
  voiceName: string;
  voiceVolume: number;
  voiceRate: number;
  voicePitch: number;
  speechFrequency: SpeechFrequency;
  autoSpeak: boolean;
  speakSafety: boolean;
  speakRace: boolean;
  speakTechnique: boolean;
  speakInfo: boolean;
  microphoneDeviceId: string;
  inputSensitivity: number;
  controllerId: string;
  controllerButton: number;
  keyboardKey: string;
}

export const defaultSettings: CoachSettings = {
  driverName: "",
  swearingLevel: 0,
  voiceEngine: "neural", neuralVoice: "af_heart", spotterVoice: "am_fenrir",
  voiceName: "", voiceVolume: 0.9, voiceRate: 1.1, voicePitch: 1,
  speechFrequency: "balanced", autoSpeak: true,
  speakSafety: true, speakRace: true, speakTechnique: true, speakInfo: true,
  microphoneDeviceId: "", inputSensitivity: 6,
  controllerId: "", controllerButton: 0, keyboardKey: "Space"
};

export class SettingsStore {
  private value: CoachSettings = { ...defaultSettings };
  constructor(private readonly file: string) {}
  async initialize(): Promise<void> {
    try { this.value = normalize({ ...this.value, ...JSON.parse(await fs.readFile(this.file, "utf8")) }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  get(): CoachSettings { return { ...this.value }; }
  async update(input: Partial<CoachSettings>): Promise<CoachSettings> {
    this.value = normalize({ ...this.value, ...input });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.value, null, 2), "utf8");
    return this.get();
  }
}

export function spacingFor(frequency: SpeechFrequency): number {
  return { quiet: 12_000, balanced: 6_000, active: 3_500 }[frequency];
}

function normalize(value: CoachSettings): CoachSettings {
  const n = (v: unknown, min: number, max: number, fallback: number) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
  const frequency = ["quiet", "balanced", "active"].includes(value.speechFrequency) ? value.speechFrequency : "balanced";
  return {
    driverName: String(value.driverName ?? "").trim().replace(/[^\p{L}\p{M}' -]/gu, "").slice(0, 40),
    swearingLevel: Math.round(n(value.swearingLevel, 0, 3, 0)),
    voiceEngine: value.voiceEngine === "system" ? "system" : "neural",
    neuralVoice: ["am_fenrir", "am_michael", "af_heart", "af_bella"].includes(value.neuralVoice) ? value.neuralVoice : "af_heart",
    spotterVoice: ["am_fenrir", "am_michael", "af_heart", "af_bella"].includes(value.spotterVoice) ? value.spotterVoice : "am_fenrir",
    voiceName: String(value.voiceName ?? "").slice(0, 160),
    voiceVolume: n(value.voiceVolume, 0, 1, .9), voiceRate: n(value.voiceRate, .8, 1.25, 1.1), voicePitch: n(value.voicePitch, .5, 1.5, 1),
    speechFrequency: frequency, autoSpeak: Boolean(value.autoSpeak),
    speakSafety: Boolean(value.speakSafety), speakRace: Boolean(value.speakRace), speakTechnique: Boolean(value.speakTechnique), speakInfo: Boolean(value.speakInfo),
    microphoneDeviceId: String(value.microphoneDeviceId ?? "").slice(0, 300), inputSensitivity: n(value.inputSensitivity, 1, 20, 6),
    controllerId: String(value.controllerId ?? "").slice(0, 300), controllerButton: Math.round(n(value.controllerButton, 0, 63, 0)),
    keyboardKey: String(value.keyboardKey || "Space").slice(0, 40)
  };
}
