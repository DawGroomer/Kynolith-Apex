import type { SessionSummary } from "./types.js";

export interface DriverProfile {
  driverName: string; score: number | null; change: number | null; trend: "improved" | "declined" | "steady" | "new";
  level: string; sessions: number; completedLaps: number; personalBests: number;
  components: { braking: number; throttle: number; consistency: number; pace: number } | null;
  currentFocus: string; history: Array<{ id: string; at: number; track: string; score: number }>;
}

export function buildDriverProfile(driverName: string, all: SessionSummary[]): DriverProfile {
  const sessions = all.filter(session => session.laps.some(lap => lap.complete && lap.durationSeconds > 20));
  if (!sessions.length) return { driverName: driverName || "Driver", score: null, change: null, trend: "new", level: "Rookie",
    sessions: 0, completedLaps: 0, personalBests: 0, components: null, currentFocus: "Complete a clean timed session to establish your baseline.", history: [] };
  const bestByCombo = new Map<string, number>();
  for (const session of sessions) if (session.fastestLapSeconds) {
    const key = `${session.track}|${session.vehicle}`; bestByCombo.set(key, Math.min(bestByCombo.get(key) ?? Infinity, session.fastestLapSeconds));
  }
  const scored = sessions.map(session => scoreSession(session, bestByCombo.get(`${session.track}|${session.vehicle}`) ?? null));
  const latest = scored[0]!;
  const previous = scored.slice(1).find(entry => entry.session.track === latest.session.track && entry.session.vehicle === latest.session.vehicle) ?? scored[1];
  const change = previous ? Math.round((latest.score - previous.score) * 10) / 10 : null;
  return {
    driverName: driverName || "Driver", score: latest.score, change,
    trend: change === null ? "new" : change > 1 ? "improved" : change < -1 ? "declined" : "steady",
    level: latest.score >= 90 ? "Platinum" : latest.score >= 80 ? "Gold" : latest.score >= 70 ? "Silver" : latest.score >= 60 ? "Bronze" : "Developing",
    sessions: sessions.length, completedLaps: sessions.reduce((sum, session) => sum + session.laps.filter(lap => lap.complete).length, 0),
    personalBests: bestByCombo.size, components: latest.components, currentFocus: latest.session.primaryFocus,
    history: scored.slice(0, 10).reverse().map(entry => ({ id: entry.session.id, at: entry.session.startedAt, track: entry.session.track, score: entry.score }))
  };
}

function scoreSession(session: SessionSummary, personalBest: number | null) {
  const laps = session.laps.filter(lap => lap.complete);
  const braking = average(laps.map(lap => lap.brakingSmoothness));
  const throttle = average(laps.map(lap => lap.throttleSmoothness));
  const consistency = clamp(100 - (session.consistencySeconds ?? 5) * 8);
  const pace = session.fastestLapSeconds && personalBest ? clamp(100 - ((session.fastestLapSeconds - personalBest) / personalBest) * 500) : 60;
  const components = { braking: round(braking), throttle: round(throttle), consistency: round(consistency), pace: round(pace) };
  return { session, components, score: round(braking * .3 + throttle * .3 + consistency * .2 + pace * .2) };
}
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50; }
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
function round(value: number): number { return Math.round(value * 10) / 10; }
