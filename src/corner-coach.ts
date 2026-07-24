import type { CoachingCue, TelemetryFrame } from "./types.js";

export class CornerCoach {
  private active: TelemetryFrame[] | null = null;
  private quietFrames = 0;
  private lastFeedbackAt = 0;
  private lastPraiseAt = 0;

  ingest(frame: TelemetryFrame, enabled: boolean): CoachingCue[] {
    if (!enabled || frame.inPits) { this.active = null; this.quietFrames = 0; return []; }
    const cues: CoachingCue[] = [];
    const loaded = frame.brake > .08 || Math.abs(frame.steering) > .12 || Math.abs(frame.lateralG) > .35;
    if (!this.active && frame.speedKph > 50 && (frame.brake > .12 || Math.abs(frame.steering) > .16)) this.active = [frame];
    else if (this.active) {
      this.active.push(frame);
      this.quietFrames = !loaded && frame.throttle > .25 ? this.quietFrames + 1 : 0;
      if (this.quietFrames >= 4) {
        const result = analyzeCorner(this.active, frame);
        this.active = null; this.quietFrames = 0;
        if (result) {
          const spacing = result.positive ? 15_000 : 6_000;
          const lastAt = result.positive ? this.lastPraiseAt : this.lastFeedbackAt;
          if (frame.timestamp - lastAt >= spacing) {
            if (result.positive) this.lastPraiseAt = frame.timestamp; else this.lastFeedbackAt = frame.timestamp;
            cues.push(result.cue);
          }
        }
      } else if (this.active.length > 500) { this.active = null; this.quietFrames = 0; }
    }
    return cues;
  }
}

function analyzeCorner(frames: TelemetryFrame[], exit: TelemetryFrame): { cue: CoachingCue; positive: boolean } | null {
  const first = frames[0]!, last = frames.at(-1)!;
  const duration = (last.timestamp - first.timestamp) / 1000;
  const peakBrake = Math.max(...frames.map(frame => frame.brake));
  const peakLateral = Math.max(...frames.map(frame => Math.abs(frame.lateralG)));
  if (duration < 1 || (peakBrake < .18 && peakLateral < .45)) return null;
  const coastSeconds = frames.filter(frame => frame.brake < .06 && frame.throttle < .08 && frame.speedKph > 55).length * duration / frames.length;
  const overlap = frames.filter(frame => frame.throttle > .7 && Math.abs(frame.steering) > .32).length;
  let throttleCorrections = 0; let releaseRate = 0;
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1]!, current = frames[index]!, seconds = Math.max(.01, (current.timestamp - previous.timestamp) / 1000);
    if (previous.throttle > .4 && current.throttle < previous.throttle - .18) throttleCorrections++;
    releaseRate = Math.max(releaseRate, (previous.brake - current.brake) / seconds);
  }
  let feedback: string; let key = "corner-review"; let category: CoachingCue["category"] = "braking"; let positive = false;
  if (coastSeconds > .9) feedback = "Less coasting. Trail the brake.";
  else if (overlap > Math.max(5, frames.length * .12)) { category = "throttle"; feedback = "Unwind first, then full throttle."; }
  else if (throttleCorrections >= 2) { category = "throttle"; feedback = "Wait. One clean throttle squeeze."; }
  else if (releaseRate > 4.5 && peakBrake > .35) feedback = "Smoother brake release.";
  else {
    const exitFrames = frames.slice(-Math.max(3, Math.floor(frames.length * .2)));
    const exitThrottle = Math.max(...exitFrames.map(frame => frame.throttle));
    const clean = coastSeconds <= .35 && overlap <= 1 && throttleCorrections === 0 && releaseRate <= 3.2 && exitThrottle >= .65;
    if (!clean) return null;
    key = "corner-clean"; category = "throttle"; positive = true;
    feedback = "Good corner. Clean brake release and acceleration.";
  }
  return { cue: makeCue(exit, `${key}-${bucket(first.lapDistance)}`, feedback, category), positive };
}

function makeCue(frame: TelemetryFrame, key: string, message: string, category: CoachingCue["category"]): CoachingCue {
  return { id: `${key}-${frame.lap}-${frame.timestamp}`, at: frame.timestamp, priority: "technique", category, message, speak: true,
    expiresAt: frame.timestamp + 1_800, delayInHardPart: false };
}
function bucket(value: number): number { return Math.round(value * 100); }
