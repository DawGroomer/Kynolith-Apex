import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecordedSession, TelemetryFrame, TrackCorner, TrackModel } from "./types.js";
import { trackModel } from "./track-intelligence.js";

export class TrackModelStore {
  constructor(private readonly directory: string) {}
  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true }); }
  async resolve(session: RecordedSession): Promise<TrackModel | null> {
    const curated = trackModel(session.summary.track);
    if (curated) return curated;
    await this.initialize();
    const file = path.join(this.directory, `${slug(session.summary.track)}.json`);
    try { return JSON.parse(await readFile(file, "utf8")) as TrackModel; } catch {}
    const learned = discoverTrackModel(session);
    if (learned) await writeFile(file, JSON.stringify(learned), "utf8");
    return learned;
  }
}

export function discoverTrackModel(session: RecordedSession): TrackModel | null {
  const bestLap = session.summary.laps.filter(lap => lap.complete).sort((a, b) => a.durationSeconds - b.durationSeconds)[0]?.lap;
  if (bestLap == null) return null;
  const frames = session.frames.filter(frame => frame.lap === bestLap).sort((a, b) => a.lapDistance - b.lapDistance);
  if (frames.length < 50) return null;
  const zones: Array<{ start: number; end: number; peak: TelemetryFrame }> = [];
  let active: TelemetryFrame[] = []; let quiet = 0;
  for (const frame of frames) {
    const loaded = frame.brake > .1 || Math.abs(frame.steering) > .14 || Math.abs(frame.lateralG) > .4;
    if (loaded) { active.push(frame); quiet = 0; }
    else if (active.length) {
      active.push(frame); quiet++;
      if (quiet >= 5) { addZone(zones, active); active = []; quiet = 0; }
    }
  }
  if (active.length) addZone(zones, active);
  const merged = mergeZones(zones).filter(zone => zone.end - zone.start >= .008);
  const corners: TrackCorner[] = merged.map((zone, index) => ({ id: `${slug(session.summary.track)}-c${index + 1}`, name: `Corner ${index + 1}`,
    entry: round(zone.start), apex: round(zone.peak.lapDistance), exit: round(zone.end) }));
  return corners.length >= 3 ? { track: session.summary.track, version: 1, source: "learned", corners } : null;
}

function addZone(zones: Array<{ start: number; end: number; peak: TelemetryFrame }>, frames: TelemetryFrame[]): void {
  if (frames.length < 5) return;
  const peak = frames.slice().sort((a, b) => (Math.abs(b.lateralG) + b.brake) - (Math.abs(a.lateralG) + a.brake))[0]!;
  zones.push({ start: frames[0]!.lapDistance, end: frames.at(-1)!.lapDistance, peak });
}
function mergeZones(zones: Array<{ start: number; end: number; peak: TelemetryFrame }>) {
  const result: typeof zones = [];
  for (const zone of zones) { const previous = result.at(-1); if (previous && zone.start - previous.end < .012) { previous.end = zone.end; if (Math.abs(zone.peak.lateralG) + zone.peak.brake > Math.abs(previous.peak.lateralG) + previous.peak.brake) previous.peak = zone.peak; } else result.push({ ...zone }); }
  return result;
}
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "unknown-track"; }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
