export type SessionType = "practice" | "qualifying" | "race" | "unknown";

export interface TelemetryFrame {
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
  lateralSpeedKph?: number;
  impactMagnitude?: number;
  impactTimestamp?: number;
  fuelLiters: number;
  tireTempC: [number, number, number, number];
  tireWear: [number, number, number, number];
  tirePressurePsi: [number, number, number, number];
  brakeTempF: [number, number, number, number];
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
}

export interface RecordedLap {
  lap: number;
  durationSeconds: number;
  maxSpeedMph: number;
  averageSpeedMph: number;
  brakingSmoothness: number;
  throttleSmoothness: number;
  complete: boolean;
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
}

export interface RecordedSession {
  summary: SessionSummary;
  frames: TelemetryFrame[];
  cues: Array<{ cue: CoachingCue; lap: number; lapDistance: number }>;
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
}

export interface SessionIntelligence {
  model: TrackModel | null;
  referenceLap: number | null;
  reference: { source: "personal-best" | "expert" | "session"; label: string; lapTimeSeconds: number | null } | null;
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
  frames: TelemetryFrame[];
}

export type CoachingPriority = "critical" | "race" | "technique" | "info";
export interface CoachingCue {
  id: string;
  at: number;
  priority: CoachingPriority;
  category: "safety" | "braking" | "throttle" | "steering" | "tires" | "racecraft" | "lap";
  message: string;
  speak: boolean;
  expiresAt: number;
  delayInHardPart: boolean;
}

export interface CoachState {
  connected: boolean;
  source: "lmu" | "simulator";
  frame: TelemetryFrame | null;
  lastCue: CoachingCue | null;
  bestLapSeconds: number | null;
  lastLapSeconds: number | null;
  consistencySeconds: number | null;
}
