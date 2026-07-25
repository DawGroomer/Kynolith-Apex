import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DrivingReference, RecordedSession, TelemetryFrame } from "./types.js";

export class ReferenceStore {
  constructor(private readonly directory: string) {}
  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true }); }

  async list(): Promise<Array<Omit<DrivingReference, "frames">>> {
    await this.initialize();
    const files = (await readdir(this.directory)).filter(file => /^reference-[a-z0-9-]+\.json$/.test(file));
    const values = await Promise.all(files.map(async file => {
      try { const value = JSON.parse(await readFile(path.join(this.directory, file), "utf8")) as DrivingReference; const { frames: _frames, ...summary } = value; return summary; }
      catch { return null; }
    }));
    return values.filter((value): value is Omit<DrivingReference, "frames"> => value !== null).sort((a, b) => b.importedAt - a.importedAt);
  }

  async matching(track: string, vehicle: string): Promise<DrivingReference | null> {
    const summary = (await this.list()).find(item => item.track === track && (!item.vehicle || item.vehicle === vehicle));
    if (!summary) return null;
    try { return JSON.parse(await readFile(path.join(this.directory, `${summary.id}.json`), "utf8")) as DrivingReference; }
    catch { return null; }
  }

  async import(payload: unknown): Promise<Omit<DrivingReference, "frames">> {
    const source = payload as Partial<DrivingReference & RecordedSession>;
    const frames = sanitizeFrames(Array.isArray(source.frames) ? source.frames : []);
    if (frames.length < 50) throw new Error("Reference must contain at least 50 valid telemetry frames");
    const track = String(source.track ?? source.summary?.track ?? frames[0]?.track ?? "").trim().slice(0, 120);
    const vehicle = String(source.vehicle ?? source.summary?.vehicle ?? frames[0]?.vehicle ?? "").trim().slice(0, 160);
    if (!track) throw new Error("Reference track is missing");
    const requestedLap = fastestCompleteLap(source as RecordedSession, frames);
    const lapFrames = requestedLap == null ? frames : frames.filter(frame => frame.lap === requestedLap);
    const lapTimeSeconds = lapFrames.length > 1 ? (lapFrames.at(-1)!.timestamp - lapFrames[0]!.timestamp) / 1000 : null;
    const importedAt = Date.now(), id = `reference-${importedAt.toString(36)}`;
    const provenance = source.provenance && typeof source.provenance === "object" ? source.provenance : undefined;
    const benchmark = source.benchmark?.type === "mylmu-community-benchmark" ? source.benchmark : undefined;
    const effectiveLapTime = benchmark?.targetLapSeconds ?? lapTimeSeconds;
    const reference: DrivingReference = { id, name: String(source.name ?? `Expert ${track}`).trim().slice(0, 120), track, vehicle, importedAt, lapTimeSeconds: effectiveLapTime, frames: lapFrames,
      ...(provenance ? { provenance } : {}), ...(benchmark ? { benchmark } : {}) };
    await this.initialize();
    await writeFile(path.join(this.directory, `${id}.json`), JSON.stringify(reference), "utf8");
    const { frames: _frames, ...summary } = reference;
    return summary;
  }
}

function sanitizeFrames(values: unknown[]): TelemetryFrame[] {
  return values.filter((value): value is TelemetryFrame => {
    const frame = value as Partial<TelemetryFrame>;
    return Number.isFinite(frame.timestamp) && Number.isFinite(frame.lapDistance) && Number.isFinite(frame.speedKph) && typeof frame.track === "string";
  }).sort((a, b) => a.timestamp - b.timestamp).slice(0, 100_000);
}

function fastestCompleteLap(session: RecordedSession, frames: TelemetryFrame[]): number | null {
  const summaryLap = session.summary?.laps?.filter(lap => lap.complete).sort((a, b) => a.durationSeconds - b.durationSeconds)[0]?.lap;
  if (summaryLap != null) return summaryLap;
  const groups = new Map<number, TelemetryFrame[]>();
  for (const frame of frames) { const list = groups.get(frame.lap) ?? []; list.push(frame); groups.set(frame.lap, list); }
  return [...groups.entries()].filter(([, list]) => list[0]!.lapDistance < .08 && list.at(-1)!.lapDistance > .9)
    .sort((a, b) => (a[1].at(-1)!.timestamp - a[1][0]!.timestamp) - (b[1].at(-1)!.timestamp - b[1][0]!.timestamp))[0]?.[0] ?? null;
}
