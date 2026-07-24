import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SkillScores = { braking: number; throttle: number; consistency: number; pace: number };
export interface ExpertLabel { id: string; raw: SkillScores; expert: SkillScores; }
export interface ScoreCalibration { version: number; sampleCount: number; createdAt: number; models: Record<keyof SkillScores, { slope: number; intercept: number; meanAbsoluteError: number }>; }

const skills: Array<keyof SkillScores> = ["braking", "throttle", "consistency", "pace"];

export function buildScoreCalibration(labels: ExpertLabel[]): ScoreCalibration {
  if (labels.length < 3) throw new Error("At least three expert-labelled sessions are required");
  const models = {} as ScoreCalibration["models"];
  for (const skill of skills) {
    const points = labels.map(label => ({ x: label.raw[skill], y: label.expert[skill] }));
    const meanX = average(points.map(point => point.x)), meanY = average(points.map(point => point.y));
    const variance = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
    const slope = variance > .001 ? covariance / variance : 1, intercept = meanY - slope * meanX;
    const errors = points.map(point => Math.abs(clamp(slope * point.x + intercept) - point.y));
    models[skill] = { slope: round(slope), intercept: round(intercept), meanAbsoluteError: round(average(errors)) };
  }
  return { version: 1, sampleCount: labels.length, createdAt: Date.now(), models };
}

export function applyScoreCalibration(scores: SkillScores, calibration: ScoreCalibration | null): SkillScores {
  if (!calibration) return scores;
  return Object.fromEntries(skills.map(skill => [skill, round(clamp(calibration.models[skill].slope * scores[skill] + calibration.models[skill].intercept))])) as unknown as SkillScores;
}

export class ScoreCalibrationStore {
  private calibration: ScoreCalibration | null = null;
  constructor(private readonly file: string) {}
  async initialize(): Promise<void> { try { this.calibration = JSON.parse(await readFile(this.file, "utf8")) as ScoreCalibration; } catch {} }
  get(): ScoreCalibration | null { return this.calibration ? structuredClone(this.calibration) : null; }
  async import(labels: ExpertLabel[]): Promise<ScoreCalibration> {
    this.calibration = buildScoreCalibration(labels);
    await mkdir(path.dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(this.calibration, null, 2), "utf8");
    return this.get()!;
  }
}

function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
function round(value: number): number { return Math.round(value * 1_000) / 1_000; }
