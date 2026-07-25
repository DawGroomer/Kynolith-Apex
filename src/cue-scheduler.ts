import type { CoachingCue, TelemetryFrame } from "./types.js";

/**
 * Priority/expiry/validity scheduler, independently implemented from the
 * message-queue behavior documented in Crew Chief's MIT-licensed source.
 */
export class CueScheduler {
  private queue = new Map<string, CoachingCue>();
  private lastSpokenAt = 0;
  private minimumSpacingMs = 6_000;
  private lastLap = -1;
  private techniqueSpokenThisLap = 0;
  private lastTechniqueAt = -Infinity;
  private techniqueMinimumSpacingMs = 25_000;
  private techniqueBudgetPerLap = 2;

  setMinimumSpacing(ms: number): void { this.minimumSpacingMs = Math.max(2_000, Math.min(30_000, ms)); }
  setTechniquePolicy(mode: "quiet" | "balanced" | "active"): void {
    const policy = { quiet: { spacing: 35_000, budget: 1 }, balanced: { spacing: 25_000, budget: 2 }, active: { spacing: 20_000, budget: 3 } }[mode];
    this.techniqueMinimumSpacingMs = policy.spacing;
    this.techniqueBudgetPerLap = policy.budget;
  }

  enqueue(cues: CoachingCue[]): void {
    for (const cue of cues) {
      // A safety/spotter call invalidates queued narration. This prevents a
      // welcome or corner review from speaking immediately after an incident.
      if (cue.priority === "critical") {
        for (const [id, queued] of this.queue) if (queued.priority !== "critical") this.queue.delete(id);
      }
      // Technique advice loses value almost immediately. Keep only the newest
      // observation so the coach cannot narrate a corner that is already gone.
      if (cue.priority === "technique") {
        for (const [id, queued] of this.queue) if (queued.priority === "technique") this.queue.delete(id);
      }
      this.queue.set(cue.id, cue);
    }
  }

  next(frame: TelemetryFrame): CoachingCue | null {
    if (frame.lap !== this.lastLap) { this.lastLap = frame.lap; this.techniqueSpokenThisLap = 0; }
    for (const [id, cue] of this.queue) if (cue.expiresAt < frame.timestamp) this.queue.delete(id);
    if (this.techniqueSpokenThisLap >= this.techniqueBudgetPerLap) {
      for (const [id, cue] of this.queue) if (cue.priority === "technique") this.queue.delete(id);
    }
    const hardPart = frame.brake > 0.15 || Math.abs(frame.lateralG) > 1.15 || Math.abs(frame.steering) > 0.5;
    const candidates = [...this.queue.values()]
      .filter(cue => !(hardPart && cue.delayInHardPart))
      .sort((a, b) => score(b) - score(a) || a.at - b.at);
    const cue = candidates[0];
    if (!cue) return null;
    const spacing = cue.priority === "critical" ? 0 : this.minimumSpacingMs;
    if (frame.timestamp - this.lastSpokenAt < spacing) return null;
    if (cue.priority === "technique" && (this.techniqueSpokenThisLap >= this.techniqueBudgetPerLap || frame.timestamp - this.lastTechniqueAt < this.techniqueMinimumSpacingMs)) return null;
    this.queue.delete(cue.id);
    if (cue.priority === "critical") {
      for (const [id, queued] of this.queue) if (queued.priority !== "critical") this.queue.delete(id);
    }
    this.lastSpokenAt = frame.timestamp;
    if (cue.priority === "technique") { this.lastTechniqueAt = frame.timestamp; this.techniqueSpokenThisLap++; }
    return cue;
  }

  clear(): void { this.queue.clear(); }
}

function score(cue: CoachingCue): number {
  return { critical: 400, race: 300, technique: 200, info: 100 }[cue.priority];
}
