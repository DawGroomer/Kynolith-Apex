import type { CornerPerformance, TelemetryFrame } from "./types.js";

export type CurriculumLevel = 0 | 1 | 2 | 3;

export interface CurriculumAssessment {
  level: CurriculumLevel;
  phase: string;
  goal: string;
  telemetryFocus: string[];
  technique: { trailBrake: number; steeringEfficiency: number; throttleSqueeze: number };
  focusedDrill: { corner: string; averageLossSeconds: number; recoveryTargetSeconds: number; instruction: string } | null;
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

export function assessCurriculum(rank: string, frames: TelemetryFrame[], corners: CornerPerformance[]): CurriculumAssessment {
  const phase = curriculumForRank(rank);
  return { ...phase, technique: scoreTechnique(frames), focusedDrill: selectFocusedCorner(corners) };
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

export function selectFocusedCorner(corners: CornerPerformance[]): CurriculumAssessment["focusedDrill"] {
  const losses = new Map<string, { name: string; values: number[] }>();
  for (const corner of corners) if ((corner.deltaSeconds ?? 0) > .05) {
    const current = losses.get(corner.cornerId) ?? { name: corner.name, values: [] };
    current.values.push(corner.deltaSeconds!); losses.set(corner.cornerId, current);
  }
  const worst = [...losses.values()].map(item => ({ ...item, average: average(item.values) })).sort((a, b) => b.average - a.average)[0];
  if (!worst) return null;
  const target = worst.average * .8;
  return { corner: worst.name, averageLossSeconds: round(worst.average), recoveryTargetSeconds: round(target),
    instruction: `Focus only on ${worst.name}. Keep every other reference unchanged until you recover ${target.toFixed(2)} seconds.` };
}

function score(penalty: number, samples: number): number { return Math.round(Math.max(0, Math.min(100, 100 - penalty / Math.max(1, samples)))); }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
