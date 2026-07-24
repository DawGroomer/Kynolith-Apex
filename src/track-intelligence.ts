import type { CornerPerformance, DrivingReference, RecordedSession, SessionIntelligence, TelemetryFrame, TrackCorner } from "./types.js";

const MPH = .6213711922;

const FUJI_CORNERS: TrackCorner[] = [
  { id: "fuji-t1", name: "Turn 1", entry: .115, apex: .165, exit: .195 },
  { id: "fuji-coca-cola", name: "Coca-Cola", entry: .245, apex: .285, exit: .315 },
  { id: "fuji-100r", name: "100R", entry: .315, apex: .375, exit: .415 },
  { id: "fuji-hairpin", name: "Hairpin", entry: .415, apex: .445, exit: .475 },
  { id: "fuji-300r", name: "300R", entry: .515, apex: .545, exit: .565 },
  { id: "fuji-dunlop", name: "Dunlop", entry: .565, apex: .625, exit: .655 },
  { id: "fuji-t10", name: "Turn 10", entry: .655, apex: .690, exit: .715 },
  { id: "fuji-t11", name: "Turn 11", entry: .710, apex: .745, exit: .775 },
  { id: "fuji-panasonic", name: "Panasonic", entry: .775, apex: .815, exit: .865 }
];

export function trackModel(track: string): SessionIntelligence["model"] {
  if (!/fuji/i.test(track)) return null;
  return { track: "Fuji Speedway", version: 1, corners: FUJI_CORNERS };
}

export function identifyCorner(track: string, lapDistance: number): TrackCorner | null {
  return trackModel(track)?.corners.find(corner => lapDistance >= corner.entry && lapDistance <= corner.exit) ?? null;
}

export function analyzeSessionIntelligence(session: RecordedSession, personalBest?: { label: string; lapTimeSeconds: number; frames: TelemetryFrame[] } | null, expert?: DrivingReference | null): SessionIntelligence {
  const model = trackModel(session.summary.track);
  const completeLaps = session.summary.laps.filter(lap => lap.complete && lap.durationSeconds > 20);
  const referenceLap = completeLaps.sort((a, b) => a.durationSeconds - b.durationSeconds)[0]?.lap ?? null;
  const perLap = new Map<number, TelemetryFrame[]>();
  for (const frame of session.frames) {
    const list = perLap.get(frame.lap) ?? []; list.push(frame); perLap.set(frame.lap, list);
  }
  const sessionReferenceFrames = referenceLap == null ? [] : perLap.get(referenceLap) ?? [];
  const activeReference = expert?.frames.length ? { source: "expert" as const, label: expert.name, lapTimeSeconds: expert.lapTimeSeconds, frames: expert.frames }
    : personalBest?.frames.length ? { source: "personal-best" as const, ...personalBest }
      : sessionReferenceFrames.length ? { source: "session" as const, label: `Lap ${referenceLap}`, lapTimeSeconds: completeLaps.find(lap => lap.lap === referenceLap)?.durationSeconds ?? null, frames: sessionReferenceFrames } : null;
  const referenceFrames = activeReference?.frames ?? [];
  const corners: CornerPerformance[] = [];
  if (model) for (const lap of completeLaps) for (const corner of model.corners) {
    const frames = within(perLap.get(lap.lap) ?? [], corner);
    const reference = within(referenceFrames, corner);
    if (frames.length < 3 || reference.length < 3) continue;
    const timeSeconds = elapsed(frames), referenceSeconds = elapsed(reference), deltaSeconds = timeSeconds - referenceSeconds;
    const throttle = frames.find(frame => frame.lapDistance >= corner.apex && frame.throttle >= .7)?.lapDistance ?? null;
    const brake = frames.find(frame => frame.brake >= .15)?.lapDistance ?? null;
    const cueMessages = session.cues.filter(entry => entry.lap === lap.lap && entry.lapDistance >= corner.entry && entry.lapDistance <= corner.exit).map(entry => entry.cue.message);
    corners.push({ cornerId: corner.id, name: corner.name, lap: lap.lap, timeSeconds, deltaSeconds,
      minSpeedMph: Math.min(...frames.map(frame => frame.speedKph * MPH)), exitSpeedMph: frames.at(-1)!.speedKph * MPH,
      peakBrake: Math.max(...frames.map(frame => frame.brake)), brakePoint: brake, throttlePoint: throttle,
      grade: deltaSeconds < -.08 ? "gain" : deltaSeconds > .15 ? "loss" : "clean", cueMessages });
  }
  const braking = average(completeLaps.map(lap => lap.brakingSmoothness));
  const throttle = average(completeLaps.map(lap => lap.throttleSmoothness));
  const consistency = session.summary.consistencySeconds == null ? 50 : clamp(100 - session.summary.consistencySeconds * 20);
  const relevantFrames = completeLaps.flatMap(lap => perLap.get(lap.lap) ?? []);
  const trackDiscipline = clamp(100 - relevantFrames.filter(frame => frame.offTrackWheels >= 2).length / Math.max(1, relevantFrames.length) * 1000);
  const skills = { braking, throttle, consistency, trackDiscipline };
  const lowest = Object.entries(skills).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "consistency";
  return { model, referenceLap,
    reference: activeReference ? { source: activeReference.source, label: activeReference.label, lapTimeSeconds: activeReference.lapTimeSeconds } : null,
    personalBestSeconds: personalBest?.lapTimeSeconds ?? completeLaps[0]?.durationSeconds ?? null,
    theoreticalBestSeconds: theoreticalBest(completeLaps.map(lap => perLap.get(lap.lap) ?? [])),
    sessionObjective: objective(lowest), skills, corners };
}

function within(frames: TelemetryFrame[], corner: TrackCorner): TelemetryFrame[] { return frames.filter(frame => frame.lapDistance >= corner.entry && frame.lapDistance <= corner.exit); }
function elapsed(frames: TelemetryFrame[]): number { return Math.max(0, (frames.at(-1)!.timestamp - frames[0]!.timestamp) / 1000); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function clamp(value: number): number { return Math.round(Math.max(0, Math.min(100, value))); }
function theoreticalBest(laps: TelemetryFrame[][]): number | null {
  if (!laps.length) return null;
  let total = 0;
  for (let bin = 0; bin < 20; bin++) {
    const start = bin / 20, end = (bin + 1) / 20;
    const times = laps.map(frames => frames.filter(frame => frame.lapDistance >= start && frame.lapDistance < end)).filter(frames => frames.length > 1).map(elapsed);
    if (!times.length) return null;
    total += Math.min(...times);
  }
  return total;
}
function objective(skill: string): string {
  return ({ braking: "Brake-release consistency: make pressure reduction smooth and repeatable.", throttle: "Exit discipline: use one progressive throttle application.",
    consistency: "Repeatability: hold the same references for three clean laps.", trackDiscipline: "Track discipline: finish three valid laps without a limits warning." } as Record<string, string>)[skill] ?? "Build three clean, repeatable laps.";
}
