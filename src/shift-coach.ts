import type { CoachingCue, TelemetryFrame } from "./types.js";

export const SHIFT_COACH_PHRASES = {
  "shift-up-early": "Early upshift. Hold this gear longer before pulling the paddle.",
  "shift-up-late": "Late upshift. Shift just before the limiter, not on it.",
  "shift-down-overrev": "Downshift later. That gear is over-revving the engine.",
  "shift-down-rushed": "Space the downshifts. Keep the rear axle settled.",
  "shift-down-missing": "Take one more downshift. Keep the engine responsive through the corner.",
  "shift-exit-low": "Use one lower gear here. Improve rotation and exit response."
} as const;

export class ShiftCoach {
  private peakRpm = 0;
  private loadedSamples = 0;
  private lastValidGear = 0;
  private lastValidRpm = 0;
  private lastDownshiftAt = 0;
  private lowRpmBrakeAt = 0;
  private lowRpmExitAt = 0;
  private cooldown = new Map<string, number>();

  ingest(frame: TelemetryFrame): CoachingCue[] {
    const cues: CoachingCue[] = [];
    if (frame.inPits || frame.speedKph < 25 || frame.rpm < 1_000) { this.remember(frame); return cues; }
    if (frame.throttle > .7 && frame.gear > 0 && frame.rpm > 3_000) {
      this.peakRpm = Math.max(this.peakRpm, frame.rpm);
      this.loadedSamples++;
    }
    const calibrated = this.loadedSamples >= 80 && this.peakRpm >= 5_500;
    const gear = frame.gear > 0 ? frame.gear : this.lastValidGear;
    if (calibrated && gear > 0 && this.lastValidGear > 0 && gear !== this.lastValidGear) {
      const beforeRatio = this.lastValidRpm / this.peakRpm;
      const afterRatio = frame.rpm / this.peakRpm;
      if (gear > this.lastValidGear && frame.throttle > .6) {
        if (beforeRatio < .76) this.emit(cues, frame, "shift-up-early", 25_000);
        else if (beforeRatio > .985) this.emit(cues, frame, "shift-up-late", 25_000);
      } else if (gear < this.lastValidGear && frame.brake > .12) {
        if (afterRatio > .965) this.emit(cues, frame, "shift-down-overrev", 20_000);
        else if (this.lastDownshiftAt && frame.timestamp - this.lastDownshiftAt < 260) this.emit(cues, frame, "shift-down-rushed", 20_000);
        this.lastDownshiftAt = frame.timestamp;
      }
    }
    if (calibrated) {
      const ratio = frame.rpm / this.peakRpm;
      const missingDownshift = frame.brake > .35 && gear >= 3 && frame.speedKph < 150 && ratio < .57;
      this.lowRpmBrakeAt = missingDownshift ? (this.lowRpmBrakeAt || frame.timestamp) : 0;
      if (this.lowRpmBrakeAt && frame.timestamp - this.lowRpmBrakeAt >= 650) {
        this.emit(cues, frame, "shift-down-missing", 30_000); this.lowRpmBrakeAt = 0;
      }
      const lowExit = frame.throttle > .55 && Math.abs(frame.steering) > .16 && gear > 1 && ratio < .54;
      this.lowRpmExitAt = lowExit ? (this.lowRpmExitAt || frame.timestamp) : 0;
      if (this.lowRpmExitAt && frame.timestamp - this.lowRpmExitAt >= 450) {
        this.emit(cues, frame, "shift-exit-low", 30_000); this.lowRpmExitAt = 0;
      }
    }
    this.remember(frame);
    return cues;
  }

  private remember(frame: TelemetryFrame): void {
    if (frame.gear > 0) { this.lastValidGear = frame.gear; this.lastValidRpm = frame.rpm; }
  }

  private emit(out: CoachingCue[], frame: TelemetryFrame, key: keyof typeof SHIFT_COACH_PHRASES, waitMs: number): void {
    const last = this.cooldown.get(key) ?? 0;
    if (frame.timestamp - last < waitMs) return;
    this.cooldown.set(key, frame.timestamp);
    out.push({ id: `${key}-${frame.timestamp}`, at: frame.timestamp, priority: "technique", category: "shift", message: SHIFT_COACH_PHRASES[key], speak: true, expiresAt: frame.timestamp + 5_000, delayInHardPart: true });
  }
}
