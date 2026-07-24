import type { SessionSummary } from "./types.js";

export interface DriverProfile {
  driverName: string; score: number | null; change: number | null; trend: "improved" | "declined" | "steady" | "new";
  level: string; sessions: number; completedLaps: number; personalBests: number;
  components: { braking: number; throttle: number; consistency: number; pace: number } | null;
  currentFocus: string; history: Array<{ id: string; at: number; track: string; score: number }>;
  academy: DriverAcademy;
}

export interface DriverAcademy {
  rank: "Rookie" | "Developing" | "Advanced" | "Expert" | "Prodigy";
  nextRank: "Developing" | "Advanced" | "Expert" | "Prodigy" | null;
  promotionProgress: number;
  requirements: Array<{ label: string; current: string; target: string; met: boolean }>;
  objective: string;
  drill: { name: string; instructions: string; success: string };
  mastery: Array<{ skill: string; score: number; state: "learning" | "capable" | "mastered" }>;
}

export function buildDriverProfile(driverName: string, all: SessionSummary[]): DriverProfile {
  const sessions = all.filter(session => session.laps.some(lap => lap.complete && lap.durationSeconds > 20));
  if (!sessions.length) return { driverName: driverName || "Driver", score: null, change: null, trend: "new", level: "Rookie",
    sessions: 0, completedLaps: 0, personalBests: 0, components: null, currentFocus: "Complete a clean timed session to establish your baseline.", history: [], academy: emptyAcademy() };
  const bestByCombo = new Map<string, number>();
  for (const session of sessions) if (session.fastestLapSeconds) {
    const key = `${session.track}|${session.vehicle}`; bestByCombo.set(key, Math.min(bestByCombo.get(key) ?? Infinity, session.fastestLapSeconds));
  }
  const scored = sessions.map(session => scoreSession(session, bestByCombo.get(`${session.track}|${session.vehicle}`) ?? null));
  const latest = scored[0]!;
  const previous = scored.slice(1).find(entry => entry.session.track === latest.session.track && entry.session.vehicle === latest.session.vehicle) ?? scored[1];
  const change = previous ? Math.round((latest.score - previous.score) * 10) / 10 : null;
  const completedLaps = sessions.reduce((sum, session) => sum + session.laps.filter(lap => lap.complete).length, 0);
  const academy = buildAcademy(latest.components, latest.score, sessions.length, completedLaps, bestByCombo.size);
  return {
    driverName: driverName || "Driver", score: latest.score, change,
    trend: change === null ? "new" : change > 1 ? "improved" : change < -1 ? "declined" : "steady",
    level: academy.rank, sessions: sessions.length, completedLaps,
    personalBests: bestByCombo.size, components: latest.components, currentFocus: latest.session.primaryFocus,
    history: scored.slice(0, 10).reverse().map(entry => ({ id: entry.session.id, at: entry.session.startedAt, track: entry.session.track, score: entry.score })), academy
  };
}

function buildAcademy(components: NonNullable<DriverProfile["components"]>, score: number, sessions: number, laps: number, combinations: number): DriverAcademy {
  const ranks = [
    { rank: "Developing" as const, score: 60, minSkill: 55, sessions: 2, laps: 5, combinations: 1 },
    { rank: "Advanced" as const, score: 75, minSkill: 70, sessions: 4, laps: 12, combinations: 1 },
    { rank: "Expert" as const, score: 86, minSkill: 80, sessions: 8, laps: 25, combinations: 2 },
    { rank: "Prodigy" as const, score: 94, minSkill: 90, sessions: 15, laps: 50, combinations: 3 }
  ];
  const minSkill = Math.min(...Object.values(components));
  let rank: DriverAcademy["rank"] = "Rookie"; let next = ranks[0]!;
  for (const gate of ranks) {
    const met = score >= gate.score && minSkill >= gate.minSkill && sessions >= gate.sessions && laps >= gate.laps && combinations >= gate.combinations;
    if (met) rank = gate.rank; else { next = gate; break; }
  }
  const isProdigy = rank === "Prodigy";
  const requirements = isProdigy ? [] : [
    { label: "Driver score", current: score.toFixed(1), target: String(next.score), met: score >= next.score },
    { label: "Lowest skill", current: minSkill.toFixed(1), target: String(next.minSkill), met: minSkill >= next.minSkill },
    { label: "Completed sessions", current: String(sessions), target: String(next.sessions), met: sessions >= next.sessions },
    { label: "Valid laps", current: String(laps), target: String(next.laps), met: laps >= next.laps },
    { label: "Track/car baselines", current: String(combinations), target: String(next.combinations), met: combinations >= next.combinations }
  ];
  const promotionProgress = isProdigy ? 100 : Math.round(average(requirements.map(item => Math.min(1, Number(item.current) / Number(item.target)))) * 100);
  const weakest = Object.entries(components).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "consistency";
  const drill = drillFor(weakest);
  return { rank, nextRank: isProdigy ? null : next.rank, promotionProgress, requirements,
    objective: isProdigy ? "Sustain expert pace across changing conditions, traffic, and stint phases." : `${next.rank} promotion: raise ${weakest} while preserving clean, repeatable laps.`,
    drill, mastery: Object.entries(components).map(([skill, value]) => ({ skill, score: value, state: value >= 90 ? "mastered" : value >= 75 ? "capable" : "learning" })) };
}

function drillFor(skill: string): DriverAcademy["drill"] {
  return ({ braking: { name: "Brake Release Ladder", instructions: "Run three laps using the same brake marker. Change only the release: abrupt, moderate, then progressive.", success: "Progressive lap is fastest without increasing steering corrections." },
    throttle: { name: "One-Squeeze Exit", instructions: "For three laps, delay throttle until steering begins to unwind, then use one continuous application.", success: "No secondary lift and improved exit speed on two consecutive laps." },
    consistency: { name: "Three-Lap Repeatability", instructions: "Hold identical markers and drive at ninety-five percent for three valid laps.", success: "All three laps fall within 0.7 seconds." },
    pace: { name: "Reference Delta Hunt", instructions: "Choose the two largest corner losses and change only one reference point per lap.", success: "Recover at least 0.2 seconds without losing time in the following corner." }
  } as Record<string, DriverAcademy["drill"]>)[skill] ?? { name: "Clean Baseline", instructions: "Complete three clean representative laps.", success: "Three valid laps within one second." };
}

function emptyAcademy(): DriverAcademy { return { rank: "Rookie", nextRank: "Developing", promotionProgress: 0,
  requirements: [{ label: "Valid laps", current: "0", target: "5", met: false }], objective: "Establish a clean telemetry baseline.",
  drill: { name: "Clean Baseline", instructions: "Complete three clean representative laps.", success: "Three valid laps within one second." }, mastery: [] }; }

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
