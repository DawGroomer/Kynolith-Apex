export type SessionType = "practice" | "qualifying" | "race" | "unknown";

export interface TelemetryFrame {
  schemaVersion?: number;
  timestamp: number;
  session: SessionType;
  track: string;
  vehicle: string;
  lap: number;
  lapDistance: number;
  worldX: number;
  worldZ: number;
  speedKph: number;
  gear: number;
  rpm: number;
  throttle: number;
  brake: number;
  steering: number;
  lateralG: number;
  longitudinalG: number;
  yawRateRadPerSec?: number;
  lateralSpeedKph?: number;
  impactMagnitude?: number;
  impactTimestamp?: number;
  fuelLiters: number;
  tireTempC: [number, number, number, number];
  tireWear: [number, number, number, number];
  tirePressurePsi: [number, number, number, number];
  brakeTempF: [number, number, number, number];
  wheelRotationRadPerSec?: [number, number, number, number];
  wheelSlipRatio?: [number, number, number, number];
  wheelGripFraction?: [number, number, number, number];
  wheelBrakePressure?: [number, number, number, number];
  wheelDetached?: [boolean, boolean, boolean, boolean];
  wheelFlat?: [boolean, boolean, boolean, boolean];
  absActive?: boolean;
  tcActive?: boolean;
  batteryChargePercent?: number | null;
  electricMotorState?: number;
  electricMotorTorqueNm?: number;
  virtualEnergyPercent?: number | null;
  rearBrakeBiasPercent?: number;
  damageSeverity?: number;
  partDetached?: boolean;
  overheating?: boolean;
  position: number;
  classPosition: number;
  vehicleClass?: string;
  gapAheadSeconds: number | null;
  gapBehindSeconds: number | null;
  opponentAheadClass?: string | null;
  opponentBehindClass?: string | null;
  opponentAheadDistanceMeters?: number | null;
  opponentBehindDistanceMeters?: number | null;
  opponentAheadSpeedKph?: number | null;
  opponentBehindSpeedKph?: number | null;
  inPits: boolean;
  yellowFlag: boolean;
  carLeft: boolean;
  carRight: boolean;
  offTrackWheels: number;
  trackLimitsSteps: number;
  lapInvalidated: boolean;
  blueFlag?: boolean;
  sectorYellow?: boolean;
  yellowFlagState?: number;
  gamePhase?: number;
  penalties?: number;
  pitState?: number;
  raining?: number;
  trackWetness?: number;
  ambientTempC?: number;
  trackTempC?: number;
  sessionTimeRemainingSeconds?: number;
  trackLengthMeters?: number;
}

export interface RecordedLap {
  lap: number;
  durationSeconds: number;
  maxSpeedMph: number;
  averageSpeedMph: number;
  brakingSmoothness: number;
  throttleSmoothness: number;
  complete: boolean;
  quality?: DataQuality;
}

export type DataQualityStatus = "trusted" | "limited" | "quarantined";
export interface DataQuality {
  version: number;
  status: DataQualityStatus;
  score: number;
  confidence: "low" | "moderate" | "high";
  reasons: string[];
  sampleCount: number;
  activeDrivingPercent?: number;
  distanceCoveragePercent?: number;
  discontinuities?: number;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  track: string;
  vehicle: string;
  session: SessionType;
  laps: RecordedLap[];
  fastestLapSeconds: number | null;
  consistencySeconds: number | null;
  maxSpeedMph: number;
  coachCueCount: number;
  primaryFocus: string;
  quality?: DataQuality;
}

export interface RecordedSession {
  summary: SessionSummary;
  frames: TelemetryFrame[];
  cues: Array<{ cue: CoachingCue; lap: number; lapDistance: number; audioDelivery?: AudioDeliveryMetric }>;
}

export interface AudioDeliveryMetric {
  measuredAt: number;
  telemetryEventAt?: number | undefined;
  queuedAt?: number | undefined;
  requestToPlaybackMs: number;
  telemetryToPlaybackMs: number | null;
  queueDelayMs?: number;
  synthesisMs?: number;
  playbackStartedAt?: number | undefined;
  engine: "kokoro-q8" | "prerecorded" | "system";
  voice?: string;
  role?: "coach" | "spotter";
  cacheHit?: boolean;
  outcome?: "played" | "cancelled" | "dropped" | "failed";
  fallbackReason?: string | null;
  deadlineMet: boolean;
}

export interface TrackCorner {
  id: string;
  name: string;
  entry: number;
  apex: number;
  exit: number;
}
export interface TrackModel { track: string; version: number; source: "curated" | "learned"; corners: TrackCorner[]; }

export interface CornerPerformance {
  cornerId: string;
  name: string;
  lap: number;
  timeSeconds: number;
  deltaSeconds: number | null;
  minSpeedMph: number;
  exitSpeedMph: number;
  peakBrake: number;
  brakePoint: number | null;
  throttlePoint: number | null;
  grade: "gain" | "clean" | "loss";
  cueMessages: string[];
  uncertaintySeconds: number;
  confidence: "low" | "moderate" | "high";
}

export interface SessionIntelligence {
  model: TrackModel | null;
  referenceLap: number | null;
  reference: { source: "personal-best" | "expert" | "community-benchmark" | "session"; label: string; lapTimeSeconds: number | null; confidenceRangeSeconds?: [number, number] } | null;
  personalBestSeconds: number | null;
  theoreticalBestSeconds: number | null;
  sessionObjective: string;
  skills: { braking: number; throttle: number; consistency: number; trackDiscipline: number };
  corners: CornerPerformance[];
  racecraft: { multiclassEncounters: number; predictiveWarnings: number };
  setupFindings: Array<{ area: string; evidence: string; recommendation: string; confidence: "low" | "moderate" }>;
  setupReport: SetupReport;
  strategy: StrategyReport;
  curriculum: import("./curriculum.js").CurriculumAssessment;
}

export interface StrategyReport {
  status: "insufficient-data" | "stable" | "watch" | "pit-risk";
  completedLaps: number;
  fuelPerLapGallons: number | null;
  estimatedLapsRemaining: number | null;
  tireWearPerLapPercent: number | null;
  paceTrendSecondsPerLap: number | null;
  projectedStintLaps: number | null;
  virtualEnergyPerLapPercent: number | null;
  estimatedEnergyLapsRemaining: number | null;
  recommendation: string;
}

export interface SetupDiagnosis {
  id: string;
  area: string;
  classification: "driver-first" | "setup-candidate";
  confidence: "low" | "moderate" | "high";
  priority: number;
  symptom: string;
  evidence: string[];
  recommendation: string;
  validation: string;
}

export interface SetupReport {
  status: "not-ready" | "driver-first" | "setup-ready";
  readinessScore: number;
  blockers: string[];
  diagnoses: SetupDiagnosis[];
}

export interface DrivingReference {
  id: string;
  name: string;
  track: string;
  vehicle: string;
  importedAt: number;
  lapTimeSeconds: number | null;
  provenance?: {
    format: "apex-json" | "lmu-duckdb" | "csv" | "motec-csv" | "mylmu-community-benchmark";
    sourceFile: string;
    driver?: string;
    channels: string[];
    warnings: string[];
  };
  benchmark?: CommunityBenchmarkMetadata;
  frames: TelemetryFrame[];
}

export interface CommunityBenchmarkMetadata {
  type: "mylmu-community-benchmark";
  label: "MyLMU Community Benchmark";
  driver: string;
  sourceUrl: string;
  observedAt: string;
  geometrySource: "driver-owned-lmu-duckdb";
  geometryLapSeconds: number;
  targetLapSeconds: number;
  targetLapRangeSeconds: [number, number];
  sectors: Array<{ sector: 1 | 2 | 3; seconds: number; rangeSeconds: [number, number] }>;
  targets: Array<{
    cornerId: string;
    confidence: "low" | "moderate";
    brakeShiftMeters?: { midpoint: number; range: [number, number] };
    minimumSpeedGainKph?: { midpoint: number; range: [number, number] };
    fullThrottleShiftMeters?: { midpoint: number; range: [number, number] };
  }>;
  warnings: string[];
}

export type CoachingPriority = "critical" | "race" | "technique" | "info";
export interface CoachingCue {
  id: string;
  at: number;
  priority: CoachingPriority;
  category: "safety" | "braking" | "throttle" | "steering" | "shift" | "tires" | "racecraft" | "lap";
  message: string;
  speak: boolean;
  expiresAt: number;
  delayInHardPart: boolean;
}

export interface CoachState {
  connected: boolean;
  source: "lmu" | "simulator";
  sessionActive?: boolean;
  frame: TelemetryFrame | null;
  lastCue: CoachingCue | null;
  bestLapSeconds: number | null;
  lastLapSeconds: number | null;
  consistencySeconds: number | null;
}
