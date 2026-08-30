import type { CoachingCue, TelemetryFrame } from "./types.js";
import { RacecraftPredictor } from "./racecraft-predictor.js";
import { StrategyCoach } from "./strategy-coach.js";
import { ShiftCoach } from "./shift-coach.js";

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
  private racecraftPredictor = new RacecraftPredictor();
  private strategyCoach = new StrategyCoach();
  private shiftCoach = new ShiftCoach();
  private leftSeenAt = 0; private rightSeenAt = 0; private leftClearAt = 0; private rightClearAt = 0;
  private leftTransitionAt = 0; private rightTransitionAt = 0;
  private offTrackSeen = 0; private offTrackClear = 0; private offTrackActive = false; private lastTrackLimitsSteps = 0; private trackLimitsInitialized = false; private lapInvalidated = false;
  private lastImpactTimestamp = 0; private impactInitialized = false; private spinSeen = 0; private spinClear = 0; private spinActive = false; private lastIncidentAt = 0;
  private blueActive = false; private sectorYellowActive = false; private damageActive = false; private overheatingActive = false;
  private yellowSeenAt = 0; private sectorYellowSeenAt = 0;
  private penalties = 0; private penaltiesInitialized = false; private rainBand = 0; private lockupSeen = 0;

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
    if (frame.yellowFlag) {
      if (!this.yellowActive && !this.yellowSeenAt) this.yellowSeenAt = frame.timestamp;
      if (!this.yellowActive && frame.timestamp - this.yellowSeenAt >= 100) {
        this.yellowActive = true;
        this.emit(cues, frame, "yellow", 0, "critical", "safety", "Yellow flag. No overtaking. Watch for stopped cars.");
      }
    } else { this.yellowSeenAt = 0; this.yellowActive = false; }
    const localYellow = Boolean(frame.sectorYellow && !frame.yellowFlag);
    if (localYellow) {
      if (!this.sectorYellowActive && !this.sectorYellowSeenAt) this.sectorYellowSeenAt = frame.timestamp;
      if (!this.sectorYellowActive && frame.timestamp - this.sectorYellowSeenAt >= 100) {
        this.sectorYellowActive = true;
        this.emit(cues, frame, "local-yellow", 0, "critical", "safety", "Local yellow. No overtaking. Watch for an incident.");
      }
    } else { this.sectorYellowSeenAt = 0; this.sectorYellowActive = false; }
    if (frame.blueFlag && !this.blueActive) this.emit(cues, frame, "blue-flag", 0, "race", "racecraft", "Blue flag. Faster car approaching. Stay predictable.");
    this.blueActive = Boolean(frame.blueFlag);
    if (this.penaltiesInitialized && (frame.penalties ?? 0) > this.penalties) this.emit(cues, frame, "new-penalty", 0, "critical", "safety", "New penalty. Check the message center and serve it within the required window.");
    this.penalties = frame.penalties ?? 0; this.penaltiesInitialized = true;
    const severeDamage = Boolean(frame.partDetached || frame.wheelDetached?.some(Boolean) || frame.wheelFlat?.some(Boolean));
    if (severeDamage && !this.damageActive) this.emit(cues, frame, "severe-damage", 0, "critical", "safety", frame.wheelFlat?.some(Boolean) ? "Puncture detected. Reduce speed and return to the pits safely." : "Severe damage detected. Stabilize the car and return to the pits.");
    this.damageActive = severeDamage;
    if (frame.overheating && !this.overheatingActive) this.emit(cues, frame, "overheating", 0, "critical", "safety", "Car overheating. Reduce load and prepare to pit.");
    this.overheatingActive = Boolean(frame.overheating);
    const nextRainBand = (frame.raining ?? 0) >= .35 ? 2 : (frame.raining ?? 0) >= .05 ? 1 : 0;
    if (nextRainBand > this.rainBand) this.emit(cues, frame, "rain-increase", 20_000, "race", "tires", nextRainBand === 2 ? "Rain increasing. Expect standing water and a longer braking distance." : "Rain beginning. Check grip before committing to the next braking zone.");
    else if (nextRainBand < this.rainBand) this.emit(cues, frame, "rain-ease", 20_000, "info", "tires", "Rain easing. Grip may recover unevenly; stay off painted lines.");
    this.rainBand = nextRainBand;
    const liveOverlap = frame.speedKph >= 15 && !frame.inPits;
    if (frame.carLeft && liveOverlap) {
      this.leftClearAt = 0;
      if (!this.carLeftActive && !this.leftSeenAt) this.leftSeenAt = frame.timestamp;
      if (!this.carLeftActive && frame.timestamp - this.leftSeenAt >= 150 && frame.timestamp - this.leftTransitionAt >= 750) {
        this.carLeftActive = true; this.leftTransitionAt = frame.timestamp; this.emit(cues, frame, "car-left", 0, "critical", "racecraft", "Car left. Hold your line.");
      }
    } else {
      this.leftSeenAt = 0;
      if (this.carLeftActive && !this.leftClearAt) this.leftClearAt = frame.timestamp;
      if (this.carLeftActive && frame.timestamp - this.leftClearAt >= 500) {
        this.carLeftActive = false; this.leftTransitionAt = frame.timestamp; this.leftClearAt = 0; this.emit(cues, frame, "clear-left", 0, "critical", "racecraft", "Clear left.");
      }
    }
    if (frame.carRight && liveOverlap) {
      this.rightClearAt = 0;
      if (!this.carRightActive && !this.rightSeenAt) this.rightSeenAt = frame.timestamp;
      if (!this.carRightActive && frame.timestamp - this.rightSeenAt >= 150 && frame.timestamp - this.rightTransitionAt >= 750) {
        this.carRightActive = true; this.rightTransitionAt = frame.timestamp; this.emit(cues, frame, "car-right", 0, "critical", "racecraft", "Car right. Hold your line.");
      }
    } else {
      this.rightSeenAt = 0;
      if (this.carRightActive && !this.rightClearAt) this.rightClearAt = frame.timestamp;
      if (this.carRightActive && frame.timestamp - this.rightClearAt >= 500) {
        this.carRightActive = false; this.rightTransitionAt = frame.timestamp; this.rightClearAt = 0; this.emit(cues, frame, "clear-right", 0, "critical", "racecraft", "Clear right.");
      }
    }
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

    const wheelSlip = frame.wheelSlipRatio ?? [0, 0, 0, 0];
    const locking = frame.brake > .35 && frame.speedKph > 60 && wheelSlip.some(value => value < -.22);
    this.lockupSeen = locking ? this.lockupSeen + 1 : 0;
    if (this.lockupSeen === 3) this.emit(cues, frame, "wheel-lock", 12_000, "technique", "braking", "Wheel locking. Ease brake pressure slightly.");
    if (frame.tcActive && frame.throttle > .65 && Math.abs(frame.steering) > .2) this.emit(cues, frame, "tc-active", 15_000, "technique", "throttle", "Traction control is working. Unwind the wheel before adding more throttle.");
    cues.push(...this.shiftCoach.ingest(frame));
    if (this.curriculumLevel >= 2) cues.push(...this.racecraftPredictor.ingest(frame));
    if (this.curriculumLevel >= 3) cues.push(...this.strategyCoach.ingest(frame));

    const hottest = Math.max(...frame.tireTempC);
    const spread = hottest - Math.min(...frame.tireTempC);
    if (hottest > 115) this.emit(cues, frame, "hot-tire", 25_000, "race", "tires", "Tire temperature is critical. Back off the sliding and open the corner exits for half a lap.");
    else if (spread > 22) this.emit(cues, frame, "tire-spread", 30_000, "info", "tires", "Large tire temperature split. Build load progressively and avoid scrubbing the cold end.");
    if (this.instructionMode !== "active" && !frame.inPits && frame.speedKph > 45 && frame.timestamp - this.lastGuidanceAt >= this.instructionIntervalMs) {
      const [guidanceKey, guidance] = this.curriculumLevel === 0
        ? (frame.brake > .18 ? ["coach-brake", "Smooth off the brake. Look through the exit."] : Math.abs(frame.steering) > .3 ? ["coach-steering", "Eyes through the corner. One smooth steering input."] : ["coach-marker", "Use the same marker. Smooth on, smooth off."])
        : this.curriculumLevel === 1
          ? (frame.brake > .18 ? ["coach-brake-loaded", "Release the brake progressively and keep the front loaded."] : Math.abs(frame.steering) > .3 ? ["coach-balance", "Balance steering against throttle. Unwind before adding power."] : ["coach-min-speed", "Protect minimum speed with one clean release."])
          : frame.brake > .18 ? ["coach-reference-brake", "Release the brake smoothly and protect apex speed."]
            : Math.abs(frame.steering) > .3 ? ["coach-reference-arc", "Hold a clean arc. Minimize scrub."]
            : frame.throttle > .75 ? ["coach-reference-exit", "Good. Keep the exit clean and progressive."]
            : ["coach-session-target", "Stay on the session target. Change one reference at a time."];
      this.emit(cues, frame, guidanceKey, 18_000, "technique", "lap", guidance);
      this.lastGuidanceAt = frame.timestamp;
    }
    return cues.sort((a, b) => priorityValue(b.priority) - priorityValue(a.priority));
  }

  private emit(out: CoachingCue[], frame: TelemetryFrame, key: string, waitMs: number, priority: CoachingCue["priority"], category: CoachingCue["category"], message: string): void {
    const last = this.cooldown.get(key);
    if (last !== undefined && frame.timestamp - last < waitMs) return;
    this.cooldown.set(key, frame.timestamp);
    out.push({
      id: `${key}-${frame.timestamp}`, at: frame.timestamp, priority, category, message, speak: true,
      expiresAt: frame.timestamp + (priority === "critical" ? 2_500 : priority === "technique" ? 3_500 : 8_000),
      delayInHardPart: priority !== "critical" && category !== "racecraft"
    });
  }
}

function priorityValue(value: CoachingCue["priority"]): number {
  return { critical: 4, race: 3, technique: 2, info: 1 }[value];
}
