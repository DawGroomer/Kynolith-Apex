import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CoachingCue, RecordedLap, RecordedSession, SessionSummary, TelemetryFrame } from "./types.js";
import { analyzeLapQuality, applyCorpusQuality, applyCrossSessionBaseline, assessSessionQuality, DATA_QUALITY_VERSION, shouldSplitSession } from "./data-quality.js";

const KPH_TO_MPH = 0.6213711922;

export class SessionRecorder {
  private current: RecordedSession | null = null;
  private lastRecordedAt = 0;
  private lastObserved: TelemetryFrame | null = null;

  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true }); await this.migrateQuality(); }

  async recordFrame(frame: TelemetryFrame): Promise<void> {
    if (!this.current) this.current = createSession(frame);
    else if (this.current.summary.track !== frame.track || this.current.summary.session !== frame.session) {
      await this.finish(); this.current = createSession(frame);
    } else if (this.lastObserved && shouldSplitSession(this.lastObserved, frame)) {
      await this.finish(); this.current = createSession(frame);
    }
    this.lastObserved = frame;
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
    this.lastObserved = null;
    if (!session || session.frames.length < 20) return null;
    session.summary = applyCrossSessionBaseline(summarize(session), await this.trackVehicleBaseline(session.summary.track, session.summary.vehicle));
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

  private async migrateQuality(): Promise<void> {
    const files = (await readdir(this.directory)).filter(file => /^session-\d+\.json$/.test(file));
    const loaded: Array<{ file: string; session: RecordedSession }> = [];
    for (const file of files) {
      const location = path.join(this.directory, file);
      try {
        const session = JSON.parse(await readFile(location, "utf8")) as RecordedSession;
        loaded.push({ file, session });
      } catch { /* Preserve unreadable source files for manual recovery. */ }
    }
    if (!loaded.some(({ session }) => session.summary.quality?.version !== DATA_QUALITY_VERSION || session.summary.laps.some(lap => lap.quality?.version !== DATA_QUALITY_VERSION))) return;
    const summaries = applyCorpusQuality(loaded.map(({ session }) => summarize(session)));
    for (let index = 0; index < loaded.length; index++) {
      const entry = loaded[index]!;
      entry.session.summary = summaries[index]!;
      await writeFile(path.join(this.directory, entry.file), JSON.stringify(entry.session), "utf8");
    }
  }

  private async trackVehicleBaseline(track: string, vehicle: string): Promise<number | null> {
    const files = (await readdir(this.directory)).filter(file => /^session-\d+\.json$/.test(file));
    const times: number[] = [];
    for (const file of files) try {
      const session = JSON.parse(await readFile(path.join(this.directory, file), "utf8")) as RecordedSession;
      if (session.summary.track !== track || session.summary.vehicle !== vehicle) continue;
      for (const lap of session.summary.laps) if (lap.quality?.status === "trusted" && lap.durationSeconds >= 35) times.push(lap.durationSeconds);
    } catch { /* Ignore unreadable history without deleting it. */ }
    return times.length ? Math.min(...times) : null;
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
      coachCueCount: 0, primaryFocus: "Build consistent, clean laps.", quality: { version: DATA_QUALITY_VERSION, status: "limited", score: 0, confidence: "low", reasons: ["Session is still recording"], sampleCount: 0 } },
    frames: [], cues: []
  };
}

export function summarize(session: RecordedSession): SessionSummary {
  const grouped = new Map<number, TelemetryFrame[]>();
  for (const frame of session.frames) {
    const frames = grouped.get(frame.lap) ?? []; frames.push(frame); grouped.set(frame.lap, frames);
  }
  const laps: RecordedLap[] = [...grouped.entries()].sort(([a], [b]) => a - b).map(([lap, frames]) => {
    const { frames: _frames, ...analysis } = analyzeLapQuality(lap, frames); return analysis;
  });
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
    primaryFocus: focusText(primary),
    quality: assessSessionQuality(laps, session.frames)
  };
}

function focusText(category?: string): string {
  return ({ braking: "Prioritize a progressive brake release and reduce coasting.", throttle: "Feed throttle in as steering lock comes off.",
    steering: "Use one smooth turn-in and reduce corrective steering.", tires: "Reduce sliding and manage tire temperature spread.",
    safety: "Prioritize flag awareness and controlled pit-lane procedures.", racecraft: "Improve traffic prediction and multiclass positioning." } as Record<string, string>)[category ?? ""] ?? "Build consistent, clean laps before chasing peak pace.";
}

function average(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function standardDeviation(values: number[]): number { const mean = average(values); return Math.sqrt(average(values.map(value => (value - mean) ** 2))); }
