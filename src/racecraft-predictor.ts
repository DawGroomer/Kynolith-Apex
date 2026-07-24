import type { CoachingCue, TelemetryFrame } from "./types.js";

export class RacecraftPredictor {
  private previous: TelemetryFrame | null = null;
  private lastAheadAt = 0;
  private lastBehindAt = 0;

  ingest(frame: TelemetryFrame): CoachingCue[] {
    const previous = this.previous;
    this.previous = frame;
    if (!previous || frame.inPits || frame.yellowFlag || frame.session !== "race") return [];
    const seconds = (frame.timestamp - previous.timestamp) / 1000;
    if (seconds < .03 || seconds > 1) return [];
    const cues: CoachingCue[] = [];
    const behindClosing = closingRate(previous.opponentBehindDistanceMeters, frame.opponentBehindDistanceMeters, seconds);
    const behindTtc = timeToContact(frame.opponentBehindDistanceMeters, behindClosing);
    const differentBehindClass = differentClass(frame.vehicleClass, frame.opponentBehindClass);
    if (differentBehindClass && behindClosing > 3 && behindTtc !== null && behindTtc < 5 && frame.timestamp - this.lastBehindAt > 25_000) {
      this.lastBehindAt = frame.timestamp;
      cues.push(cue(frame, "multiclass-behind", "Faster class closing. Stay predictable."));
    }
    const aheadClosing = closingRate(previous.opponentAheadDistanceMeters, frame.opponentAheadDistanceMeters, seconds);
    const aheadTtc = timeToContact(frame.opponentAheadDistanceMeters, aheadClosing);
    const differentAheadClass = differentClass(frame.vehicleClass, frame.opponentAheadClass);
    if (differentAheadClass && aheadClosing > 2 && aheadTtc !== null && aheadTtc < 5 && frame.timestamp - this.lastAheadAt > 25_000) {
      this.lastAheadAt = frame.timestamp;
      cues.push(cue(frame, "multiclass-ahead", "Slower class ahead. Plan the exit."));
    }
    return cues;
  }
}

function closingRate(previous: number | null | undefined, current: number | null | undefined, seconds: number): number {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  const rate = (Number(previous) - Number(current)) / seconds;
  return Math.abs(rate) > 100 ? 0 : rate;
}
function timeToContact(distance: number | null | undefined, rate: number): number | null {
  return Number.isFinite(distance) && rate > .5 ? Number(distance) / rate : null;
}
function differentClass(player?: string, opponent?: string | null): boolean { return Boolean(player && opponent && player !== "Unknown" && opponent !== "Unknown" && player.toLowerCase() !== opponent.toLowerCase()); }
function cue(frame: TelemetryFrame, key: string, message: string): CoachingCue {
  return { id: `${key}-${frame.timestamp}`, at: frame.timestamp, priority: "race", category: "racecraft", message, speak: true,
    expiresAt: frame.timestamp + 2_500, delayInHardPart: true };
}
