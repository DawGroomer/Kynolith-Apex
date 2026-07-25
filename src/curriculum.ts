import type { CornerPerformance, TelemetryFrame } from "./types.js";

export type CurriculumLevel = 0 | 1 | 2 | 3;

export interface CurriculumAssessment {
  level: CurriculumLevel;
  phase: string;
  goal: string;
  telemetryFocus: string[];
  technique: { trailBrake: number; steeringEfficiency: number; throttleSqueeze: number };
  focusedDrill: {
    corner: string; averageLossSeconds: number; recoveryTargetSeconds: number; instruction: string;
    diagnosis: string; executionPlan: string[]; successCriteria: string; confidence: "low" | "moderate" | "high";
  } | null;
}

const phases = [
  { phase: "Phase 1 — Fundamentals", goal: "Machine consistency, track memory, boundaries, and safe inputs.", telemetryFocus: ["racing line", "steering smoothness", "brake markers", "track boundaries"] },
  { phase: "Phase 2 — Precision & Inputs", goal: "Trail braking, weight transfer, rotation, and progressive throttle.", telemetryFocus: ["brake release", "steering efficiency", "throttle squeeze", "minimum speed"] },
  { phase: "Phase 3 — Racecraft & Tactics", goal: "Reference deltas, repeatable pace, traffic management, and strategy.", telemetryFocus: ["corner delta", "V-min", "gear choice", "traffic closing rate", "fuel and tires"] },
  { phase: "Phase 4 — Pro Refinement", goal: "Micro-deltas, setup evidence, stint execution, and energy management.", telemetryFocus: ["sub-0.2 second deltas", "setup telemetry", "tire degradation", "lift and coast", "multiclass prediction"] }
] as const;

export function curriculumForRank(rank: string): Omit<CurriculumAssessment, "technique" | "focusedDrill"> {
  const level: CurriculumLevel = rank === "Prodigy" ? 3 : rank === "Expert" ? 2 : rank === "Advanced" ? 1 : 0;
  const selected = phases[level];
  return { level, phase: selected.phase, goal: selected.goal, telemetryFocus: [...selected.telemetryFocus] };
}

export function assessCurriculum(rank: string, frames: TelemetryFrame[], corners: CornerPerformance[], trackLengthMeters?: number): CurriculumAssessment {
  const phase = curriculumForRank(rank);
  return { ...phase, technique: scoreTechnique(frames), focusedDrill: selectFocusedCorner(corners, trackLengthMeters) };
}

export function scoreTechnique(frames: TelemetryFrame[]): CurriculumAssessment["technique"] {
  if (frames.length < 3) return { trailBrake: 50, steeringEfficiency: 50, throttleSqueeze: 50 };
  let brakeSamples = 0, brakePenalty = 0, steeringSamples = 0, steeringPenalty = 0, throttleSamples = 0, throttlePenalty = 0;
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]!, frame = frames[index]!;
    const seconds = Math.max(.001, Math.min(.25, (frame.timestamp - previous.timestamp) / 1000));
    if (previous.brake > .08 && Math.abs(frame.steering) > .08) {
      brakeSamples++; const releaseRate = (previous.brake - frame.brake) / seconds;
      brakePenalty += Math.max(0, releaseRate - 2.2) * 12 + (frame.brake > previous.brake + .08 ? 15 : 0);
    }
    if (frame.speedKph > 45) {
      steeringSamples++; const steeringRate = Math.abs(frame.steering - previous.steering) / seconds;
      steeringPenalty += Math.max(0, steeringRate - 1.8) * 5;
    }
    if (frame.throttle > previous.throttle && Math.abs(frame.steering) > .12) {
      throttleSamples++; const applicationRate = (frame.throttle - previous.throttle) / seconds;
      throttlePenalty += Math.max(0, applicationRate - 2.5) * 8;
    }
  }
  return {
    trailBrake: score(brakePenalty, brakeSamples),
    steeringEfficiency: score(steeringPenalty, steeringSamples),
    throttleSqueeze: score(throttlePenalty, throttleSamples)
  };
}

export function selectFocusedCorner(corners: CornerPerformance[], trackLengthMeters?: number): CurriculumAssessment["focusedDrill"] {
  const losses = new Map<string, { name: string; samples: CornerPerformance[] }>();
  for (const corner of corners) if ((corner.deltaSeconds ?? 0) > .05) {
    const current = losses.get(corner.cornerId) ?? { name: corner.name, samples: [] };
    current.samples.push(corner); losses.set(corner.cornerId, current);
  }
  const worst = [...losses.entries()].map(([id, item]) => ({ id, ...item, average: average(item.samples.map(sample => sample.deltaSeconds!)) })).sort((a, b) => b.average - a.average)[0];
  if (!worst) return null;
  const allSamples = corners.filter(corner => corner.cornerId === worst.id && corner.deltaSeconds !== null);
  const benchmark = [...allSamples].sort((a, b) => a.deltaSeconds! - b.deltaSeconds!)[0] ?? worst.samples[0]!;
  const current = aggregate(worst.samples);
  const trackFeet = Number.isFinite(trackLengthMeters) ? trackLengthMeters! * 3.28084 : null;
  const brakeFeet = distanceFeet(current.brakePoint, benchmark.brakePoint, trackFeet);
  const throttleFeet = distanceFeet(current.throttlePoint, benchmark.throttlePoint, trackFeet);
  const minSpeedLoss = benchmark.minSpeedMph - current.minSpeedMph;
  const exitSpeedLoss = benchmark.exitSpeedMph - current.exitSpeedMph;
  const target = Math.max(.05, worst.average * .2);
  const plan: string[] = [];
  if (brakeFeet !== null && Math.abs(brakeFeet) >= 15) {
    const measured = Math.round(Math.abs(brakeFeet)), step = Math.min(50, Math.max(10, Math.round(measured / 10) * 10));
    plan.push(brakeFeet > 0
      ? `Your marker averaged ${measured} ft later than the benchmark. Move only ${step} ft earlier this drill.`
      : `Your marker averaged ${measured} ft earlier than the benchmark. Move only ${step} ft later this drill.`);
  }
  else plan.push(`Keep the same braking marker for three laps; change release shape, not entry position.`);
  if (minSpeedLoss >= 1.5) plan.push(`Release pressure progressively and target at least ${(current.minSpeedMph + Math.min(3, minSpeedLoss)).toFixed(1)} mph minimum speed.`);
  else plan.push(`Protect the current ${current.minSpeedMph.toFixed(1)} mph minimum speed with one clean steering input.`);
  if (throttleFeet !== null && throttleFeet >= 15) plan.push(`Begin progressive throttle about ${Math.round(throttleFeet)} ft earlier only after steering starts to unwind.`);
  else if (exitSpeedLoss >= 1.5) plan.push(`Prioritize exit: target ${(current.exitSpeedMph + Math.min(3, exitSpeedLoss)).toFixed(1)} mph at corner exit without triggering extra TC.`);
  else plan.push(`Repeat the throttle pickup and avoid adding power while increasing steering lock.`);
  const cause = exitSpeedLoss >= 2.5 || (throttleFeet ?? 0) >= 25 ? "late throttle application and lost exit speed"
    : minSpeedLoss >= 2.5 ? "excess speed loss near the apex"
      : Math.abs(brakeFeet ?? 0) >= 25 ? "an inconsistent initial braking point" : "brake-release and rotation consistency";
  const confidence = confidenceFor(worst.samples);
  return { corner: worst.name, averageLossSeconds: round(worst.average), recoveryTargetSeconds: round(target), confidence,
    diagnosis: `Primary pattern: ${cause}. Recent average: ${current.minSpeedMph.toFixed(1)} mph minimum, ${current.exitSpeedMph.toFixed(1)} mph exit.`,
    instruction: `Work only on ${worst.name}. Recover the first ${target.toFixed(2)} seconds before raising the target.`, executionPlan: plan,
    successCriteria: `Pass when three consecutive clean laps stay within 0.25 seconds of each other here and average loss improves by ${target.toFixed(2)} seconds.` };
}

function aggregate(samples: CornerPerformance[]): Pick<CornerPerformance, "minSpeedMph" | "exitSpeedMph" | "brakePoint" | "throttlePoint"> {
  const nullableAverage = (values: Array<number | null>) => { const valid = values.filter((value): value is number => value !== null); return valid.length ? average(valid) : null; };
  return { minSpeedMph: average(samples.map(sample => sample.minSpeedMph)), exitSpeedMph: average(samples.map(sample => sample.exitSpeedMph)),
    brakePoint: nullableAverage(samples.map(sample => sample.brakePoint)), throttlePoint: nullableAverage(samples.map(sample => sample.throttlePoint)) };
}
function distanceFeet(current: number | null, benchmark: number | null, trackFeet: number | null): number | null { return current === null || benchmark === null || trackFeet === null ? null : (current - benchmark) * trackFeet; }
function confidenceFor(samples: CornerPerformance[]): "low" | "moderate" | "high" { const high = samples.filter(sample => sample.confidence === "high").length; return samples.length >= 3 && high / samples.length >= .67 ? "high" : samples.length >= 2 ? "moderate" : "low"; }

function score(penalty: number, samples: number): number { return Math.round(Math.max(0, Math.min(100, 100 - penalty / Math.max(1, samples)))); }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
