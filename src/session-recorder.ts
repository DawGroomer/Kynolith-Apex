import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CoachingCue, RecordedLap, RecordedSession, SessionSummary, TelemetryFrame } from "./types.js";

const KPH_TO_MPH = 0.6213711922;

export class SessionRecorder {
  private current: RecordedSession | null = null;
  private lastRecordedAt = 0;

  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true }); }

  async recordFrame(frame: TelemetryFrame): Promise<void> {
    if (!this.current) this.current = createSession(frame);
    else if (this.current.summary.track !== frame.track || this.current.summary.session !== frame.session) {
      await this.finish(); this.current = createSession(frame);
    }
    if (frame.timestamp - this.lastRecordedAt < 100) return;
    this.lastRecordedAt = frame.timestamp;
    this.current.frames.push(frame);
    this.current.summary.endedAt = frame.timestamp;
  }

  recordCue(cue: CoachingCue, frame: TelemetryFrame): void {
    this.current?.cues.push({ cue, lap: frame.lap, lapDistance: frame.lapDistance });
  }

  async finish(): Promise<SessionSummary | null> {
    const session = this.current;
    this.current = null;
    this.lastRecordedAt = 0;
    if (!session || session.frames.length < 20) return null;
    session.summary = summarize(session);
    await writeFile(path.join(this.directory, `${session.summary.id}.json`), JSON.stringify(session), "utf8");
    return session.summary;
  }

  async list(): Promise<SessionSummary[]> {
    await this.initialize();
    const files = (await readdir(this.directory)).filter(file => /^session-\d+\.json$/.test(file));
    const summaries = await Promise.all(files.map(async file => {
      try { return (JSON.parse(await readFile(path.join(this.directory, file), "utf8")) as RecordedSession).summary; }
      catch { return null; }
    }));
    return summaries.filter((value): value is SessionSummary => value !== null).sort((a, b) => b.startedAt - a.startedAt);
  }

  async get(id: string): Promise<RecordedSession | null> {
    if (!/^session-\d+$/.test(id)) return null;
    try { return JSON.parse(await readFile(path.join(this.directory, `${id}.json`), "utf8")) as RecordedSession; }
    catch { return null; }
  }

  async comparable(track: string, vehicle: string): Promise<RecordedSession[]> {
    const matches = (await this.list()).filter(summary => summary.track === track && summary.vehicle === vehicle);
    const sessions = await Promise.all(matches.map(summary => this.get(summary.id)));
    return sessions.filter((session): session is RecordedSession => session !== null);
  }
}

function createSession(frame: TelemetryFrame): RecordedSession {
  const id = `session-${frame.timestamp}`;
  return {
    summary: { id, startedAt: frame.timestamp, endedAt: frame.timestamp, track: frame.track, vehicle: frame.vehicle,
      session: frame.session, laps: [], fastestLapSeconds: null, consistencySeconds: null, maxSpeedMph: 0,
      coachCueCount: 0, primaryFocus: "Build consistent, clean laps." },
    frames: [], cues: []
  };
}

function summarize(session: RecordedSession): SessionSummary {
  const grouped = new Map<number, TelemetryFrame[]>();
  for (const frame of session.frames) {
    const frames = grouped.get(frame.lap) ?? []; frames.push(frame); grouped.set(frame.lap, frames);
  }
  const laps: RecordedLap[] = [...grouped.entries()].sort(([a], [b]) => a - b).map(([lap, frames]) => analyzeLap(lap, frames));
  if (laps.length > 1) { laps[0]!.complete = false; laps.at(-1)!.complete = false; }
  const completeTimes = laps.filter(lap => lap.complete && lap.durationSeconds > 20).map(lap => lap.durationSeconds);
  const categories = new Map<string, number>();
  for (const entry of session.cues) categories.set(entry.cue.category, (categories.get(entry.cue.category) ?? 0) + 1);
  const primary = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    ...session.summary,
    laps,
    fastestLapSeconds: completeTimes.length ? Math.min(...completeTimes) : null,
    consistencySeconds: completeTimes.length > 1 ? standardDeviation(completeTimes) : null,
    maxSpeedMph: Math.max(0, ...session.frames.map(frame => frame.speedKph * KPH_TO_MPH)),
    coachCueCount: session.cues.length,
    primaryFocus: focusText(primary)
  };
}

function analyzeLap(lap: number, frames: TelemetryFrame[]): RecordedLap {
  const durationSeconds = Math.max(0, (frames.at(-1)!.timestamp - frames[0]!.timestamp) / 1000);
  const speeds = frames.map(frame => frame.speedKph * KPH_TO_MPH);
  return {
    lap, durationSeconds, maxSpeedMph: Math.max(0, ...speeds), averageSpeedMph: average(speeds),
    brakingSmoothness: smoothness(frames.map(frame => frame.brake)),
    throttleSmoothness: smoothness(frames.map(frame => frame.throttle)),
    complete: frames[0]!.lapDistance < 0.08 && frames.at(-1)!.lapDistance > 0.9
  };
}

function smoothness(values: number[]): number {
  if (values.length < 2) return 100;
  const variation = values.slice(1).reduce((sum, value, i) => sum + Math.abs(value - values[i]!), 0) / (values.length - 1);
  return Math.round(Math.max(0, Math.min(100, 100 - variation * 350)));
}

function focusText(category?: string): string {
  return ({ braking: "Prioritize a progressive brake release and reduce coasting.", throttle: "Feed throttle in as steering lock comes off.",
    steering: "Use one smooth turn-in and reduce corrective steering.", tires: "Reduce sliding and manage tire temperature spread.",
    safety: "Prioritize flag awareness and controlled pit-lane procedures.", racecraft: "Improve traffic prediction and multiclass positioning." } as Record<string, string>)[category ?? ""] ?? "Build consistent, clean laps before chasing peak pace.";
}

function average(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function standardDeviation(values: number[]): number { const mean = average(values); return Math.sqrt(average(values.map(value => (value - mean) ** 2))); }
