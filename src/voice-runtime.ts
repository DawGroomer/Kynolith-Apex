import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpeechEmotion, SpeechRole } from "./prosody-director.js";

export interface VoiceRequest { text: string; voice: string; speed: number; role: SpeechRole; emotion: SpeechEmotion; phraseKey?: string; }
export interface VoiceResult { wav: ArrayBuffer; engine: "kokoro-q8"; cacheHit: boolean; queueDelayMs: number; synthesisMs: number; }

export class VoiceRuntime {
  private tail: Promise<void> = Promise.resolve();
  private memory = new Map<string, ArrayBuffer>();
  constructor(private readonly cacheDirectory: string, private readonly synthesize: (request: VoiceRequest) => Promise<ArrayBuffer>, private readonly canSynthesize: () => boolean = () => true) {}

  async render(request: VoiceRequest): Promise<VoiceResult> {
    const key = cacheKey(request);
    const queuedAt = Date.now();
    const memory = this.memory.get(key);
    if (memory) return { wav: memory.slice(0), engine: "kokoro-q8", cacheHit: true, queueDelayMs: 0, synthesisMs: 0 };
    const disk = await this.read(key);
    if (disk) { this.memory.set(key, disk); return { wav: disk.slice(0), engine: "kokoro-q8", cacheHit: true, queueDelayMs: 0, synthesisMs: 0 }; }
    if (!this.canSynthesize()) throw new Error("Memory guard blocked uncached neural speech");
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const queueDelayMs = Date.now() - queuedAt;
    const started = Date.now();
    try {
      const wav = await this.synthesize(request);
      this.memory.set(key, wav.slice(0));
      await this.write(key, wav);
      return { wav, engine: "kokoro-q8", cacheHit: false, queueDelayMs, synthesisMs: Date.now() - started };
    } finally { release(); }
  }

  async prewarm(requests: VoiceRequest[]): Promise<void> { for (const request of requests) await this.render(request); }
  private location(key: string): string { return path.join(this.cacheDirectory, `${key}.wav`); }
  private async read(key: string): Promise<ArrayBuffer | null> { try { const data = await readFile(this.location(key)); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); } catch { return null; } }
  private async write(key: string, wav: ArrayBuffer): Promise<void> { await mkdir(this.cacheDirectory, { recursive: true }); await writeFile(this.location(key), Buffer.from(wav)); }
}

function cacheKey(request: VoiceRequest): string {
  const source = `${request.voice}|${request.speed.toFixed(2)}|${request.role}|${request.emotion}|${request.phraseKey ?? request.text}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `${request.role}-${request.voice}-${(hash >>> 0).toString(16)}`.replace(/[^a-z0-9_-]/gi, "_");
}
