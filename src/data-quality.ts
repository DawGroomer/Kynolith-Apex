import type { DataQuality, RecordedLap, SessionSummary, TelemetryFrame } from "./types.js";

export const DATA_QUALITY_VERSION = 3;
const KPH_TO_MPH = 0.6213711922;

export interface AnalyzedLap extends RecordedLap { frames: TelemetryFrame[]; }

export function analyzeLapQuality(lap: number, input: TelemetryFrame[]): AnalyzedLap {
  const frames = input.slice().sort((a, b) => a.timestamp - b.timestamp);
  const reasons: string[] = [];
  if (!frames.length) return emptyLap(lap, "No telemetry samples");
  const durationSeconds = Math.max(0, (frames.at(-1)!.timestamp - frames[0]!.timestamp) / 1000);
  const speeds = frames.map(frame => frame.speedKph * KPH_TO_MPH);
  const active = frames.filter(frame => frame.speedKph >= 30).length / frames.length;
  const minimumDistance = Math.min(...frames.map(frame => frame.lapDistance));
  const maximumDistance = Math.max(...frames.map(frame => frame.lapDistance));
  const coverage = Math.max(0, Math.min(1, maximumDistance - minimumDistance));
  let discontinuities = 0, backwardJumps = 0, invalidValues = 0;
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!;
    if (![frame.timestamp, frame.lapDistance, frame.speedKph, frame.throttle, frame.brake, frame.steering].every(Number.isFinite)
      || frame.speedKph < -1 || frame.speedKph > 450 || frame.lapDistance < -.02 || frame.lapDistance > 1.05) invalidValues++;
    if (!index) continue;
    const previous = frames[index - 1]!;
    const gap = frame.timestamp - previous.timestamp;
    if (gap <= 0 || gap > 2_000) discontinuities++;
    if (frame.lapDistance < previous.lapDistance - .04) backwardJumps++;
  }
  const apparentComplete = minimumDistance < .08 && maximumDistance > .9 && coverage >= .82;
  if (frames.length < 100) reasons.push("Fewer than 100 representative samples");
  if (durationSeconds < 35) reasons.push("Lap duration is too short to be representative");
  if (durationSeconds > 600) reasons.push("Lap duration exceeds the plausibility limit");
  if (active < .55) reasons.push("Less than 55% of the lap contains active driving");
  if (average(speeds) < 25) reasons.push("Average speed is below the representative-driving threshold");
  if (Math.max(...speeds) < 50) reasons.push("Maximum speed is below the representative-driving threshold");
  if (!apparentComplete) reasons.push("Lap-distance coverage is incomplete");
  if (discontinuities) reasons.push(`${discontinuities} telemetry discontinuity${discontinuities === 1 ? "" : "ies"}`);
  if (backwardJumps) reasons.push(`${backwardJumps} backward distance jump${backwardJumps === 1 ? "" : "s"}`);
  if (invalidValues) reasons.push(`${invalidValues} invalid telemetry sample${invalidValues === 1 ? "" : "s"}`);
  let score = 100;
  score -= frames.length < 100 ? 25 : 0;
  score -= durationSeconds < 35 || durationSeconds > 600 ? 35 : 0;
  score -= active < .55 ? Math.min(35, Math.round((.55 - active) * 100)) : 0;
  score -= average(speeds) < 25 ? 25 : 0;
  score -= Math.max(...speeds) < 50 ? 20 : 0;
  score -= apparentComplete ? 0 : 25;
  score -= Math.min(40, discontinuities * 15 + backwardJumps * 10 + invalidValues * 5);
  score = clamp(score);
  const hardFailure = invalidValues > 0 || discontinuities > 1 || backwardJumps > 1 || durationSeconds > 600 || average(speeds) < 10;
  const status: DataQuality["status"] = hardFailure ? "quarantined" : apparentComplete && score >= 75 ? "trusted" : "limited";
  const quality: DataQuality = { version: DATA_QUALITY_VERSION, status, score, confidence: score >= 90 ? "high" : score >= 70 ? "moderate" : "low",
    reasons, sampleCount: frames.length, activeDrivingPercent: round(active * 100), distanceCoveragePercent: round(coverage * 100), discontinuities };
  return { lap, durationSeconds: round(durationSeconds), maxSpeedMph: Math.max(0, ...speeds), averageSpeedMph: average(speeds),
    brakingSmoothness: status === "trusted" ? smoothness(frames.map(frame => frame.brake), frames.map(frame => frame.speedKph > 40 && frame.brake > .02)) : 0,
    throttleSmoothness: status === "trusted" ? smoothness(frames.map(frame => frame.throttle), frames.map(frame => frame.speedKph > 40 && frame.throttle > .02)) : 0,
    complete: status === "trusted", quality, frames };
}

export function assessSessionQuality(laps: RecordedLap[], frames: TelemetryFrame[]): DataQuality {
  const trusted = laps.filter(lap => lap.quality?.status === "trusted");
  const quarantined = laps.filter(lap => lap.quality?.status === "quarantined");
  const reasons: string[] = [];
  if (!trusted.length) reasons.push("No trusted complete lap is available for progression scoring");
  if (quarantined.length) reasons.push(`${quarantined.length} lap${quarantined.length === 1 ? "" : "s"} quarantined for implausible telemetry`);
  if (frames.length < 200) reasons.push("Session contains too little telemetry for learning analysis");
  const score = trusted.length ? clamp(average(trusted.map(lap => lap.quality?.score ?? 0)) - Math.min(25, quarantined.length * 5)) : 0;
  const status: DataQuality["status"] = trusted.length ? (quarantined.length > trusted.length ? "limited" : "trusted") : quarantined.length ? "quarantined" : "limited";
  return { version: DATA_QUALITY_VERSION, status, score: round(score), confidence: score >= 90 && trusted.length >= 3 ? "high" : score >= 70 ? "moderate" : "low",
    reasons, sampleCount: frames.length, discontinuities: laps.reduce((sum, lap) => sum + (lap.quality?.discontinuities ?? 0), 0) };
}

export function shouldSplitSession(previous: TelemetryFrame, next: TelemetryFrame): string | null {
  const gap = next.timestamp - previous.timestamp;
  if (gap < -1_000) return "Telemetry timestamp reset";
  if (gap > 5_000) return "Telemetry gap exceeded five seconds";
  if (Math.abs(next.lap - previous.lap) > 1) return "Lap counter jumped unexpectedly";
  const startFinishWrap = previous.lapDistance > .9 && next.lapDistance < .1 && gap >= 0 && gap < 1_000;
  if (next.lap === previous.lap && next.lapDistance < previous.lapDistance - .35 && !startFinishWrap) return "Lap distance reset without a lap transition";
  return null;
}

export function applyCorpusQuality(summaries: SessionSummary[]): SessionSummary[] {
  const baselines = new Map<string, number>();
  for (const summary of summaries) for (const lap of summary.laps) {
    if (lap.quality?.status !== "trusted" || lap.durationSeconds < 35) continue;
    const key = `${summary.track}|${summary.vehicle}`;
    baselines.set(key, Math.min(baselines.get(key) ?? Infinity, lap.durationSeconds));
  }
  return summaries.map(summary => applyCrossSessionBaseline(summary, baselines.get(`${summary.track}|${summary.vehicle}`) ?? null));
}

export function applyCrossSessionBaseline(summary: SessionSummary, baselineSeconds: number | null): SessionSummary {
  if (!baselineSeconds || !Number.isFinite(baselineSeconds)) return summary;
  const laps = summary.laps.map(lap => {
    if (lap.quality?.status !== "trusted" || lap.durationSeconds <= Math.max(baselineSeconds * 1.8, baselineSeconds + 60)) return lap;
    return { ...lap, complete: false, brakingSmoothness: 0, throttleSmoothness: 0, quality: { ...lap.quality, status: "quarantined" as const, score: 0,
      confidence: "low" as const, reasons: [...lap.quality.reasons, `Lap duration is implausible against the ${baselineSeconds.toFixed(1)} second track/car baseline`] } };
  });
  const quality = assessSessionQuality(laps, Array.from({ length: summary.quality?.sampleCount ?? 0 }) as TelemetryFrame[]);
  return { ...summary, laps, fastestLapSeconds: minimum(laps.filter(lap => lap.complete).map(lap => lap.durationSeconds)),
    consistencySeconds: deviation(laps.filter(lap => lap.complete).map(lap => lap.durationSeconds)), quality: { ...quality, sampleCount: summary.quality?.sampleCount ?? 0 } };
}

function emptyLap(lap: number, reason: string): AnalyzedLap { return { lap, durationSeconds: 0, maxSpeedMph: 0, averageSpeedMph: 0, brakingSmoothness: 0,
  throttleSmoothness: 0, complete: false, quality: { version: DATA_QUALITY_VERSION, status: "quarantined", score: 0, confidence: "low", reasons: [reason], sampleCount: 0 }, frames: [] }; }
function smoothness(values: number[], relevant: boolean[]): number { const selected = values.filter((_, index) => relevant[index]); if (selected.length < 8) return 0;
  const variation = selected.slice(1).reduce((sum, value, index) => sum + Math.abs(value - selected[index]!), 0) / (selected.length - 1); return clamp(100 - variation * 350); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function minimum(values: number[]): number | null { return values.length ? Math.min(...values) : null; }
function deviation(values: number[]): number | null { if (values.length < 2) return null; const mean = average(values); return Math.sqrt(average(values.map(value => (value - mean) ** 2))); }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }
function round(value: number): number { return Math.round(value * 1_000) / 1_000; }
