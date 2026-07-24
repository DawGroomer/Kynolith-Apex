import type { CoachState, SessionSummary, TelemetryFrame } from "./types.js";

export interface LmuKnowledgeCard {
  id: string;
  title: string;
  keywords: readonly string[];
  guidance: string;
}

export const LMU_KNOWLEDGE: readonly LmuKnowledgeCard[] = [
  {
    id: "traction-control",
    title: "LMU traction control",
    keywords: ["tc", "traction control", "power cut", "slip angle", "wheelspin", "traction"],
    guidance: "LMU car-side traction control has separate intervention, power-cut, and slip-angle controls. Diagnose whether the problem is longitudinal wheelspin, excessive yaw on power, or an intervention that is costing acceleration before recommending one control change."
  },
  {
    id: "abs",
    title: "LMGT3 anti-lock braking",
    keywords: ["abs", "lockup", "locking", "brake pressure", "braking"],
    guidance: "LMGT3 cars use car-side ABS. Repeated ABS activity can indicate excessive pedal demand, unloading over bumps, or an unsuitable ABS setting. First stabilize the braking trace and platform; do not assume a higher or lower setting is automatically faster."
  },
  {
    id: "virtual-energy",
    title: "Hypercar virtual energy",
    keywords: ["virtual energy", "energy", "hybrid", "deployment", "regen", "soc", "state of charge", "nrg"],
    guidance: "For LMH and LMDh cars, separate battery state of charge from LMU virtual energy. Evaluate energy used per representative lap, deployment timing, lift-and-coast cost, traffic, and the remaining stint before suggesting a strategy."
  },
  {
    id: "aero-platform",
    title: "Prototype aero platform",
    keywords: ["aero", "downforce", "ride height", "bottoming", "pitch", "wing", "high speed"],
    guidance: "Prototype performance depends strongly on ride-height and pitch control. Correlate speed, ride height, suspension travel, steering, and downforce before attributing a high-speed balance issue to wing alone. A platform change can trade corner stability against drag, traction, curb compliance, and bottoming margin."
  },
  {
    id: "brake-balance",
    title: "Brake bias and migration",
    keywords: ["brake bias", "bias", "brake migration", "migration", "entry stability", "trail brake", "brake release"],
    guidance: "Static brake bias changes front-to-rear braking demand. Brake migration changes that balance through the braking phase. Diagnose straight-line stability separately from rotation during release and recommend only one step at a time."
  },
  {
    id: "tire-state",
    title: "Tire temperature, pressure, and wear",
    keywords: ["tire", "tyre", "temperature", "pressure", "wear", "overheat", "cold tire", "hot tire"],
    guidance: "Interpret tire pressure, carcass or rubber temperature, surface temperature, wear, ambient conditions, and driving history together. A single peak temperature is not enough to prescribe pressure or alignment. Compare stable laps and distinguish sliding from sustained load."
  },
  {
    id: "balance-diagnosis",
    title: "Understeer and oversteer diagnosis",
    keywords: ["understeer", "oversteer", "won't turn", "will not turn", "loose", "push", "balance", "rotation"],
    guidance: "Classify balance by phase: braking, turn-in, mid-corner, or power exit. Use steering demand, yaw response, lateral acceleration, brake, throttle, and speed against a representative lap. The same driver description can require opposite changes in different phases."
  },
  {
    id: "mechanical-platform",
    title: "Springs, anti-roll bars, and dampers",
    keywords: ["spring", "anti-roll", "arb", "roll bar", "damper", "bump", "rebound", "curb", "kerb", "suspension"],
    guidance: "Springs and anti-roll bars primarily shape platform control and load-transfer distribution; dampers shape transient motion. Diagnose steady-state balance separately from entry or exit transients, and protect tire contact over LMU curbs and bumps."
  },
  {
    id: "differential",
    title: "Differential behavior",
    keywords: ["differential", "diff", "coast", "power ramp", "preload", "corner entry", "corner exit"],
    guidance: "Differential changes affect rotation, inside-wheel behavior, traction, and stability differently on coast and power. Identify the corner phase and throttle state before suggesting a differential change."
  },
  {
    id: "realroad-wet",
    title: "RealRoad and wet conditions",
    keywords: ["realroad", "rubber", "wet", "rain", "drying", "track temperature", "grip", "weather"],
    guidance: "LMU grip evolves with RealRoad, temperature, wetness, and traffic. Compare laps only under sufficiently similar conditions. In the wet, consider alternate lines, standing water, tire state, and progressive inputs before treating a pace change as a setup problem."
  },
  {
    id: "multiclass",
    title: "Multiclass traffic",
    keywords: ["multiclass", "traffic", "hypercar", "lmp", "lmgt3", "gte", "blue flag", "overtake", "closing rate"],
    guidance: "Separate traffic loss from driver or setup loss. Use closing rate, class, track position, and corner phase. Favor predictable placement and exits; a faster-class car should not assume the slower class can change line under load."
  },
  {
    id: "stint-strategy",
    title: "Fuel and stint strategy",
    keywords: ["fuel", "stint", "pit", "strategy", "consumption", "lift and coast", "saving"],
    guidance: "Project fuel and energy from multiple representative green-flag laps and report a range. Account for formation laps, pit loss, safety periods, traffic, weather, and measurement uncertainty. Never promise an exact remaining lap count from one sample."
  },
  {
    id: "setup-method",
    title: "LMU setup workflow",
    keywords: ["setup", "faster", "lap time", "change", "recommend", "handling"],
    guidance: "Establish a repeatable baseline, identify one phase-specific limitation, make one reversible adjustment, and validate over at least three comparable laps. State the expected benefit and trade-off. Never invent a setup option, range, or click value that is not present in the supplied car data."
  },
  {
    id: "driver-development",
    title: "Practice and driver development",
    keywords: ["practice", "confidence", "learn", "beginner", "pace", "rhythm", "consistency", "mistake"],
    guidance: "Build confidence with a repeatable brake marker, turn-in point, and throttle pickup before chasing peak pace. Hold one technique goal for at least three comparable laps, review the evidence, and change only one behavior at a time."
  }
] as const;

export function selectLmuKnowledge(question: string, limit = 3): LmuKnowledgeCard[] {
  const normalized = normalize(question);
  const queryTokens = new Set(tokenize(normalized));
  return LMU_KNOWLEDGE
    .map(card => ({ card, score: scoreCard(card, normalized, queryTokens) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, Math.max(0, limit))
    .map(result => result.card);
}

export function buildLmuGrounding(question: string, state: CoachState, recentSession: SessionSummary | null): string {
  const sections = [formatLiveTelemetry(state.frame)];
  if (state.lastCue) sections.push(`LATEST VERIFIED CUE\n${safe(state.lastCue.message, 240)}`);
  if (recentSession) sections.push(formatSession(recentSession));
  const cards = selectLmuKnowledge(question);
  if (cards.length) {
    sections.push(`LOCAL LMU KNOWLEDGE\n${cards.map(card => `- ${card.title}: ${card.guidance}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

function formatLiveTelemetry(frame: TelemetryFrame | null): string {
  if (!frame) return "LIVE LMU TELEMETRY\nUnavailable. Do not claim current car state.";
  const tireTempsF = frame.tireTempC.map(value => Math.round(value * 9 / 5 + 32)).join("/");
  const pressures = frame.tirePressurePsi.map(value => value.toFixed(1)).join("/");
  return [
    "LIVE LMU TELEMETRY (FL/FR/RL/RR where applicable)",
    `Vehicle=${safe(frame.vehicle, 100)}; Track=${safe(frame.track, 100)}; Session=${frame.session}; Lap=${frame.lap}`,
    `Speed=${Math.round(frame.speedKph * 0.621371)} mph; Gear=${frame.gear}; RPM=${Math.round(frame.rpm)}`,
    `Throttle=${percent(frame.throttle)}; Brake=${percent(frame.brake)}; Steering=${frame.steering.toFixed(2)}`,
    `Fuel=${(frame.fuelLiters * 0.264172).toFixed(1)} gal; TirePressure=${pressures} PSI; TireTemp=${tireTempsF} F`,
    `Position=P${frame.position}; ClassPosition=P${frame.classPosition}; GapAhead=${frame.gapAheadSeconds === null ? "unknown" : `${frame.gapAheadSeconds.toFixed(1)} s`}`,
    `Flags=${frame.yellowFlag ? "yellow" : "none reported"}; InPits=${frame.inPits}`
  ].join("\n");
}

function formatSession(session: SessionSummary): string {
  return [
    "LATEST COMPLETED LMU SESSION",
    `Vehicle=${safe(session.vehicle, 100)}; Track=${safe(session.track, 100)}; Type=${session.session}`,
    `FastestLap=${session.fastestLapSeconds === null ? "unknown" : `${session.fastestLapSeconds.toFixed(3)} s`}; Consistency=${session.consistencySeconds === null ? "unknown" : `+/-${session.consistencySeconds.toFixed(3)} s`}`,
    `PrimaryFocus=${safe(session.primaryFocus, 240)}`
  ].join("\n");
}

function scoreCard(card: LmuKnowledgeCard, normalized: string, queryTokens: ReadonlySet<string>): number {
  let score = 0;
  for (const keyword of card.keywords) {
    const key = normalize(keyword);
    if (normalized.includes(key)) score += key.includes(" ") ? 8 : 5;
    for (const token of tokenize(key)) if (queryTokens.has(token)) score += 1;
  }
  for (const token of tokenize(card.title)) if (queryTokens.has(token)) score += 1;
  return score;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(token => token.length > 2);
}

function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function safe(value: string, maxLength: number): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
}
