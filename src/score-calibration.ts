import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SkillScores = { braking: number; throttle: number; consistency: number; pace: number };
export interface ExpertLabel { id: string; raw: SkillScores; expert: SkillScores; }
export interface CalibrationModel {
  slope: number;
  intercept: number;
  meanAbsoluteError: number;
  crossValidatedMae: number;
  rSquared: number;
  rawMinimum: number;
  rawMaximum: number;
}
export interface ScoreCalibration {
  version: 2;
  status: "provisional" | "validated";
  sampleCount: number;
  createdAt: number;
  confidence: "low" | "moderate" | "high";
  models: Record<keyof SkillScores, CalibrationModel>;
  warnings: string[];
}

const skills: Array<keyof SkillScores> = ["braking", "throttle", "consistency", "pace"];
export const MINIMUM_CALIBRATION_LABELS = 12;
export const VALIDATED_CALIBRATION_LABELS = 30;

export function buildScoreCalibration(labels: ExpertLabel[]): ScoreCalibration {
  validateLabels(labels);
  const models = {} as ScoreCalibration["models"];
  const warnings: string[] = [];
  for (const skill of skills) {
    const points = labels.map(label => ({ x: label.raw[skill], y: label.expert[skill] }));
    const model = fit(points);
    const range = model.rawMaximum - model.rawMinimum;
    if (range < 30) throw new Error(`${skill} labels need at least 30 points of raw-score coverage`);
    if (model.slope < .25 || model.slope > 2.5) throw new Error(`${skill} calibration slope is implausible; review label consistency`);
    if (model.crossValidatedMae > 12) throw new Error(`${skill} expert labels are too inconsistent (cross-validated MAE ${model.crossValidatedMae.toFixed(1)})`);
    if (model.crossValidatedMae > 8) warnings.push(`${skill} calibration error remains high`);
    if (model.rSquared < .35) warnings.push(`${skill} labels have weak agreement with telemetry scores`);
    models[skill] = model;
  }
  const validated = labels.length >= VALIDATED_CALIBRATION_LABELS
    && skills.every(skill => models[skill].crossValidatedMae <= 8 && models[skill].rSquared >= .35);
  if (!validated) warnings.unshift(`Calibration is provisional until at least ${VALIDATED_CALIBRATION_LABELS} representative labels achieve acceptable out-of-sample error`);
  const meanCvError = average(skills.map(skill => models[skill].crossValidatedMae));
  return { version: 2, status: validated ? "validated" : "provisional", sampleCount: labels.length, createdAt: Date.now(),
    confidence: validated && meanCvError <= 5 ? "high" : validated ? "moderate" : "low", models, warnings };
}

export function applyScoreCalibration(scores: SkillScores, calibration: ScoreCalibration | null): SkillScores {
  if (!calibration || calibration.version !== 2) return scores;
  const blend = calibration.status === "validated" ? .85 : .35;
  return Object.fromEntries(skills.map(skill => {
    const model = calibration.models[skill];
    const predicted = clamp(model.slope * scores[skill] + model.intercept);
    const bounded = scores[skill] + Math.max(-15, Math.min(15, predicted - scores[skill]));
    return [skill, round(scores[skill] * (1 - blend) + bounded * blend)];
  })) as unknown as SkillScores;
}

export class ScoreCalibrationStore {
  private calibration: ScoreCalibration | null = null;
  constructor(private readonly file: string) {}
  async initialize(): Promise<void> {
    try { const value = JSON.parse(await readFile(this.file, "utf8")) as ScoreCalibration; this.calibration = value.version === 2 ? value : null; }
    catch { this.calibration = null; }
  }
  get(): ScoreCalibration | null { return this.calibration ? structuredClone(this.calibration) : null; }
  async import(labels: ExpertLabel[]): Promise<ScoreCalibration> {
    const candidate = buildScoreCalibration(labels);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(candidate, null, 2), "utf8");
    this.calibration = candidate;
    return this.get()!;
  }
}

function validateLabels(labels: ExpertLabel[]): void {
  if (labels.length < MINIMUM_CALIBRATION_LABELS) throw new Error(`At least ${MINIMUM_CALIBRATION_LABELS} expert-labelled sessions are required`);
  if (new Set(labels.map(label => label.id.trim())).size !== labels.length) throw new Error("Calibration label IDs must be unique");
  for (const label of labels) {
    if (!label.id.trim()) throw new Error("Every calibration label needs an ID");
    for (const skill of skills) for (const value of [label.raw[skill], label.expert[skill]])
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Calibration scores must be between 0 and 100 (${label.id}/${skill})`);
  }
}

function fit(points: Array<{ x: number; y: number }>): CalibrationModel {
  const meanX = average(points.map(point => point.x)), meanY = average(points.map(point => point.y));
  const variance = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const slope = variance > .001 ? covariance / variance : 1, intercept = meanY - slope * meanX;
  const predictions = points.map(point => clamp(slope * point.x + intercept));
  const errors = predictions.map((prediction, index) => Math.abs(prediction - points[index]!.y));
  const residual = points.reduce((sum, point, index) => sum + (point.y - predictions[index]!) ** 2, 0);
  const total = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const crossValidated = points.map((point, heldIndex) => {
    const training = points.filter((_, index) => index !== heldIndex);
    const trainX = average(training.map(item => item.x)), trainY = average(training.map(item => item.y));
    const trainVariance = training.reduce((sum, item) => sum + (item.x - trainX) ** 2, 0);
    const trainSlope = trainVariance > .001 ? training.reduce((sum, item) => sum + (item.x - trainX) * (item.y - trainY), 0) / trainVariance : 1;
    return Math.abs(clamp(trainSlope * point.x + trainY - trainSlope * trainX) - point.y);
  });
  return { slope: round(slope), intercept: round(intercept), meanAbsoluteError: round(average(errors)), crossValidatedMae: round(average(crossValidated)),
    rSquared: round(total > .001 ? Math.max(-1, 1 - residual / total) : 0), rawMinimum: Math.min(...points.map(point => point.x)), rawMaximum: Math.max(...points.map(point => point.x)) };
}
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
function round(value: number): number { return Math.round(value * 1_000) / 1_000; }
