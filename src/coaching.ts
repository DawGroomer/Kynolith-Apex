import type { CoachingCue, TelemetryFrame } from "./types.js";
import { CornerCoach } from "./corner-coach.js";
import { RacecraftPredictor } from "./racecraft-predictor.js";
import { StrategyCoach } from "./strategy-coach.js";

interface Sample { frame: TelemetryFrame; }

export class CoachingEngine {
  private history: Sample[] = [];
  private cooldown = new Map<string, number>();
  private yellowActive = false;
  private carLeftActive = false;
  private carRightActive = false;
  private lastGuidanceAt = 0;
  private lastLap = 0;
  private instructionIntervalMs = 20_000;
  private instructionMode: "quiet" | "balanced" | "active" = "balanced";
  private curriculumLevel: 0 | 1 | 2 | 3 = 0;
  private cornerCoach = new CornerCoach();
  private racecraftPredictor = new RacecraftPredictor();
  private strategyCoach = new StrategyCoach();
  private leftSeen = 0; private rightSeen = 0; private leftClear = 0; private rightClear = 0;
  private offTrackSeen = 0; private offTrackClear = 0; private offTrackActive = false; private lastTrackLimitsSteps = 0; private trackLimitsInitialized = false; private lapInvalidated = false;
  private lastImpactTimestamp = 0; private impactInitialized = false; private spinSeen = 0; private spinClear = 0; private spinActive = false; private lastIncidentAt = 0;

  setInstructionMode(mode: "quiet" | "balanced" | "active"): void {
    this.instructionMode = mode;
    this.instructionIntervalMs = { quiet: 35_000, balanced: 20_000, active: 12_000 }[mode];
  }

  setCurriculumLevel(level: 0 | 1 | 2 | 3): void { this.curriculumLevel = level; }

  ingest(frame: TelemetryFrame): CoachingCue[] {
    this.history.push({ frame });
    const cutoff = frame.timestamp - 12_000;
    while (this.history[0] && this.history[0].frame.timestamp < cutoff) this.history.shift();

    const cues: CoachingCue[] = [];
    if (!this.lastGuidanceAt) this.lastGuidanceAt = frame.timestamp;
    if (frame.yellowFlag && !this.yellowActive) this.emit(cues, frame, "yellow", 0, "critical", "safety", "Yellow flag. No overtaking; reduce pace and watch for stopped cars.");
    this.yellowActive = frame.yellowFlag;
    this.leftSeen = frame.carLeft ? this.leftSeen + 1 : 0; this.rightSeen = frame.carRight ? this.rightSeen + 1 : 0;
    this.leftClear = frame.carLeft ? 0 : this.leftClear + 1; this.rightClear = frame.carRight ? 0 : this.rightClear + 1;
    if (this.leftSeen === 3 && !this.carLeftActive) { this.carLeftActive = true; this.emit(cues, frame, "car-left", 3_000, "critical", "racecraft", "Car left. Hold your line."); }
    if (this.rightSeen === 3 && !this.carRightActive) { this.carRightActive = true; this.emit(cues, frame, "car-right", 3_000, "critical", "racecraft", "Car right. Hold your line."); }
    if (this.leftClear === 12 && this.carLeftActive) { this.carLeftActive = false; this.emit(cues, frame, "clear-left", 3_000, "critical", "racecraft", "Clear left."); }
    if (this.rightClear === 12 && this.carRightActive) { this.carRightActive = false; this.emit(cues, frame, "clear-right", 3_000, "critical", "racecraft", "Clear right."); }
    const newImpact = this.impactInitialized && (frame.impactTimestamp ?? 0) > this.lastImpactTimestamp && (frame.impactMagnitude ?? 0) >= 3;
    this.lastImpactTimestamp = Math.max(this.lastImpactTimestamp, frame.impactTimestamp ?? 0);
    this.impactInitialized = true;
    const lateralSpeed = Math.abs(frame.lateralSpeedKph ?? 0);
    const spinning = frame.speedKph > 25 && lateralSpeed > Math.max(22, frame.speedKph * .28);
    this.spinSeen = spinning ? this.spinSeen + 1 : 0;
    this.spinClear = spinning ? 0 : this.spinClear + 1;
    if (newImpact) {
      this.lastIncidentAt = frame.timestamp;
      this.emit(cues, frame, "impact", 5_000, "critical", "safety", "Impact. Hold the brakes. Check traffic, then rejoin safely.");
    } else if (this.spinSeen === 2 && !this.spinActive) {
      this.spinActive = true;
      this.lastIncidentAt = frame.timestamp;
      this.emit(cues, frame, "spin", 5_000, "critical", "safety", "Spin. Hold the brakes. Stabilize the car, then rejoin safely.");
    }
    if (this.spinClear >= 20) this.spinActive = false;
    const incidentActive = frame.timestamp - this.lastIncidentAt < 8_000;
    this.offTrackSeen = frame.offTrackWheels >= 2 ? this.offTrackSeen + 1 : 0;
    this.offTrackClear = frame.offTrackWheels < 2 ? this.offTrackClear + 1 : 0;
    if (this.offTrackSeen === 3 && !this.offTrackActive) { this.offTrackActive = true; if (!incidentActive) this.emit(cues, frame, "track-edge", 0, "critical", "racecraft", "Track limits. Two wheels off—bring it back inside."); }
    if (this.offTrackClear >= 20 && this.offTrackActive) this.offTrackActive = false;
    if (!incidentActive && this.trackLimitsInitialized && frame.trackLimitsSteps > this.lastTrackLimitsSteps) this.emit(cues, frame, "track-limits-step", 0, "critical", "racecraft", "Track limits violation. Keep the next one inside the white line.");
    this.lastTrackLimitsSteps = frame.trackLimitsSteps;
    this.trackLimitsInitialized = true;
    if (!incidentActive && frame.lapInvalidated && !this.lapInvalidated) this.emit(cues, frame, "lap-invalid", 0, "critical", "racecraft", "Lap invalidated for track limits. Reset and build the next lap cleanly.");
    this.lapInvalidated = frame.lapInvalidated;
    if (this.lastLap && frame.lap > this.lastLap) this.emit(cues, frame, `lap-${frame.lap}`, 0, "info", "lap", `Lap ${frame.lap}. Build it.`);
    this.lastLap = frame.lap;
    if (frame.inPits && frame.speedKph > 80) this.emit(cues, frame, "pit-speed", 4_000, "critical", "safety", "Pit lane speed. Brake now and engage the limiter.");

    const prev = this.history.at(-2)?.frame;
    if (prev && this.instructionMode !== "active" && !frame.inPits) {
      const steeringDelta = Math.abs(frame.steering - prev.steering);
      if (frame.speedKph > 120 && steeringDelta > 0.22 && frame.brake < 0.1) {
        this.emit(cues, frame, "steering-spike", 10_000, "technique", "steering", "Easy on that initial steering input. One clean turn-in will keep the platform settled.");
      }
      if (prev.brake > 0.45 && frame.brake < 0.08 && frame.throttle < 0.08 && frame.speedKph > 70) {
        this.emit(cues, frame, "coast", 12_000, "technique", "braking", "You're close. Release the brake more progressively toward the apex and shorten that coast phase.");
      }
      if (prev.throttle < 0.2 && frame.throttle > 0.85 && Math.abs(frame.steering) > 0.42) {
        this.emit(cues, frame, "throttle-stab", 12_000, "technique", "throttle", "Nice and patient here. Feed in the throttle as you unwind the wheel.");
      }
      if (Math.abs(prev.steering) > 0.35 && Math.abs(frame.steering) < 0.18 && frame.throttle > 0.65 && frame.throttle >= prev.throttle) {
        this.emit(cues, frame, "clean-exit", 35_000, "technique", "throttle", "That's better. Good unwind, and a clean drive off the corner.");
      }
    }
    cues.push(...this.cornerCoach.ingest(frame, this.instructionMode === "active"));
    if (this.curriculumLevel >= 2) cues.push(...this.racecraftPredictor.ingest(frame));
    if (this.curriculumLevel >= 3) cues.push(...this.strategyCoach.ingest(frame));

    const hottest = Math.max(...frame.tireTempC);
    const spread = hottest - Math.min(...frame.tireTempC);
    if (hottest > 115) this.emit(cues, frame, "hot-tire", 25_000, "race", "tires", "Tire temperature is critical. Back off the sliding and open the corner exits for half a lap.");
    else if (spread > 22) this.emit(cues, frame, "tire-spread", 30_000, "info", "tires", "Large tire temperature split. Build load progressively and avoid scrubbing the cold end.");
    if (this.instructionMode !== "active" && !frame.inPits && frame.speedKph > 45 && frame.timestamp - this.lastGuidanceAt >= this.instructionIntervalMs) {
      const guidance = this.curriculumLevel === 0
        ? (frame.brake > .18 ? "Smooth off the brake. Look through the exit." : Math.abs(frame.steering) > .3 ? "Eyes through the corner. One smooth steering input." : "Use the same marker. Smooth on, smooth off.")
        : this.curriculumLevel === 1
          ? (frame.brake > .18 ? "Release the brake progressively and keep the front loaded." : Math.abs(frame.steering) > .3 ? "Balance steering against throttle. Unwind before adding power." : "Protect minimum speed with one clean release.")
          : frame.brake > .18 ? "Match the reference release and protect apex speed."
            : Math.abs(frame.steering) > .3 ? "Hold the reference arc. Minimize scrub."
            : frame.throttle > .75 ? "Good. Compare that exit against the reference."
            : "Stay on the session target. Change one reference at a time.";
      this.emit(cues, frame, "coach-checkin", 18_000, "technique", "lap", guidance);
      this.lastGuidanceAt = frame.timestamp;
    }
    return cues.sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority));
  }

  private emit(out: CoachingCue[], frame: TelemetryFrame, key: string, waitMs: number, priority: CoachingCue["priority"], category: CoachingCue["category"], message: string): void {
    const last = this.cooldown.get(key) ?? 0;
    if (frame.timestamp - last < waitMs) return;
    this.cooldown.set(key, frame.timestamp);
    out.push({
      id: `${key}-${frame.timestamp}`, at: frame.timestamp, priority, category, message, speak: true,
      expiresAt: frame.timestamp + (priority === "critical" ? 2_500 : 8_000),
      delayInHardPart: priority !== "critical" && category !== "racecraft"
    });
  }
}

function priorityValue(value: CoachingCue["priority"]): number {
  return { critical: 4, race: 3, technique: 2, info: 1 }[value];
}
