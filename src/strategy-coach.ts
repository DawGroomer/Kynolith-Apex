import type { CoachingCue, TelemetryFrame } from "./types.js";

export class StrategyCoach {
  private lap = 0;
  private startFuel = 0;
  private usage: number[] = [];
  private warningBand = 0;

  ingest(frame: TelemetryFrame): CoachingCue[] {
    if (!this.lap) { this.lap = frame.lap; this.startFuel = frame.fuelLiters; return []; }
    if (frame.lap > this.lap) {
      const used = this.startFuel - frame.fuelLiters;
      if (used > .1 && used < 20) { this.usage.push(used); if (this.usage.length > 5) this.usage.shift(); }
      this.lap = frame.lap; this.startFuel = frame.fuelLiters;
    }
    if (frame.session !== "race" || frame.inPits || this.usage.length < 2) return [];
    const average = this.usage.reduce((sum, value) => sum + value, 0) / this.usage.length;
    const remaining = average > .1 ? frame.fuelLiters / average : Infinity;
    if (remaining < 1.35 && this.warningBand < 2) { this.warningBand = 2; return [cue(frame, "fuel-critical", "Fuel critical. Pit this lap.", "critical")]; }
    if (remaining < 2.5 && this.warningBand < 1) { this.warningBand = 1; return [cue(frame, "fuel-window", "Fuel window. Two laps remaining.", "race")]; }
    if (remaining > 3) this.warningBand = 0;
    return [];
  }
}

function cue(frame: TelemetryFrame, key: string, message: string, priority: CoachingCue["priority"]): CoachingCue {
  return { id: `${key}-${frame.timestamp}`, at: frame.timestamp, priority, category: priority === "critical" ? "safety" : "lap", message, speak: true,
    expiresAt: frame.timestamp + 3_000, delayInHardPart: priority !== "critical" };
}
