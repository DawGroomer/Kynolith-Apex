import type { RecordedSession, SetupDiagnosis, SetupReport, TelemetryFrame } from "./types.js";

export function buildSetupReport(session: RecordedSession): SetupReport {
  const validLaps = session.summary.laps.filter(lap => lap.complete && lap.durationSeconds > 20);
  const validNumbers = new Set(validLaps.map(lap => lap.lap));
  const frames = session.frames.filter(frame => validNumbers.has(frame.lap));
  const blockers: string[] = [];
  if (validLaps.length < 2) blockers.push("Complete at least two valid representative laps.");
  if (session.summary.consistencySeconds == null || session.summary.consistencySeconds > 1.5) blockers.push("Reduce lap-time spread below 1.5 seconds.");
  const offTrackRate = frames.filter(frame => frame.offTrackWheels >= 2 || frame.lapInvalidated).length / Math.max(1, frames.length);
  if (offTrackRate > .01) blockers.push("Run clean laps without repeated track-limit contamination.");
  const tireFrames = frames.filter(frame => frame.speedKph > 80 && Math.max(...frame.tireTempC) > 40);
  if (tireFrames.length < 50) blockers.push("Build representative tire temperature before evaluating setup.");
  const readinessScore = Math.max(0, Math.round(100 - (validLaps.length < 2 ? 35 : 0) - ((session.summary.consistencySeconds ?? 3) > 1.5 ? 30 : 0) - Math.min(25, offTrackRate * 1000) - (tireFrames.length < 50 ? 20 : 0)));
  const diagnoses = analyzePatterns(frames, tireFrames, validLaps.length, readinessScore);
  const setupCandidates = diagnoses.filter(item => item.classification === "setup-candidate");
  return { status: blockers.length ? "not-ready" : setupCandidates.length ? "setup-ready" : "driver-first", readinessScore, blockers,
    diagnoses: diagnoses.sort((a, b) => b.priority - a.priority).slice(0, 5) };
}

function analyzePatterns(frames: TelemetryFrame[], tireFrames: TelemetryFrame[], laps: number, readiness: number): SetupDiagnosis[] {
  if (!frames.length) return [];
  const diagnoses: SetupDiagnosis[] = [];
  const throttleCorrections = countTransitions(frames, (a, b) => a.throttle > .45 && b.throttle < a.throttle - .18 && Math.abs(b.steering) > .18);
  if (throttleCorrections >= laps * 2) diagnoses.push(diagnosis("traction", "Power application", "driver-first", "moderate", 85,
    "Repeated throttle lifts after initial application.", [`${throttleCorrections} throttle corrections across ${laps} valid laps.`],
    "Keep the setup unchanged first. Delay throttle until steering begins to unwind, then make one progressive application.",
    "Repeat three laps. Consider differential or traction-control changes only if corrections persist at the same corners."));
  const abruptReleases = countTransitions(frames, (a, b) => a.brake > .45 && b.brake < .08 && b.timestamp - a.timestamp < 250);
  if (abruptReleases >= laps * 2) diagnoses.push(diagnosis("brake-release", "Corner entry", "driver-first", "high", 90,
    "Brake pressure is being released too abruptly for reliable setup diagnosis.", [`${abruptReleases} abrupt releases across ${laps} valid laps.`],
    "Keep brake bias and springs unchanged. Make the release progressive as steering is added.",
    "Re-evaluate after the abrupt-release count falls below one per lap."));
  const repeatedUndersteer = repeatedBins(frames, frame => frame.speedKph > 90 && Math.abs(frame.steering) > .34 && Math.abs(frame.lateralG) < .8 && frame.throttle < .25, laps);
  if (repeatedUndersteer.length && readiness >= 75) diagnoses.push(diagnosis("understeer", "Mid-corner balance", "setup-candidate", "moderate", 75,
    "High steering demand produces limited lateral response at repeatable track locations.", [`Pattern repeated in ${repeatedUndersteer.length} lap-distance zone(s).`],
    "Test one small front-grip change: reduce front anti-roll stiffness one step. Do not combine it with pressure or aero changes.",
    "Compare minimum speed, steering demand, tire temperature, and exit speed over three clean laps."));
  if (tireFrames.length) {
    const front = average(tireFrames.flatMap(frame => frame.tireTempC.slice(0, 2))), rear = average(tireFrames.flatMap(frame => frame.tireTempC.slice(2, 4)));
    const delta = front - rear;
    if (Math.abs(delta) > 8 && readiness >= 75) diagnoses.push(diagnosis("temperature-balance", "Tire temperature balance", "setup-candidate", "moderate", 70,
      `${delta > 0 ? "Front" : "Rear"} axle is consistently hotter.`, [`Axle temperature separation averaged ${Math.abs(delta).toFixed(1)} °C.`],
      delta > 0 ? "Test one pressure change only: reduce front cold pressures by 0.5 PSI." : "Test one pressure change only: reduce rear cold pressures by 0.5 PSI.",
      "Run the same fuel load and preparation, then compare hot pressures and center/edge temperature behavior."));
    const spread = average(tireFrames.map(frame => Math.max(...frame.tirePressurePsi) - Math.min(...frame.tirePressurePsi)));
    if (spread > 1.5 && readiness >= 75) diagnoses.push(diagnosis("pressure-spread", "Hot tire pressures", "setup-candidate", "high", 80,
      "Hot pressures are not converging across the car.", [`Average hot-pressure spread was ${spread.toFixed(1)} PSI.`],
      "Adjust only the cold pressure of the outlying tire by 0.5 PSI toward the target.",
      "Repeat the same number of preparation laps and confirm the hot spread decreases."));
  }
  return diagnoses;
}

function diagnosis(id: string, area: string, classification: SetupDiagnosis["classification"], confidence: SetupDiagnosis["confidence"], priority: number,
  symptom: string, evidence: string[], recommendation: string, validation: string): SetupDiagnosis {
  return { id, area, classification, confidence, priority, symptom, evidence, recommendation, validation };
}
function countTransitions(frames: TelemetryFrame[], predicate: (a: TelemetryFrame, b: TelemetryFrame) => boolean): number {
  let count = 0;
  for (let index = 1; index < frames.length; index++) if (frames[index]!.lap === frames[index - 1]!.lap && predicate(frames[index - 1]!, frames[index]!)) count++;
  return count;
}
function repeatedBins(frames: TelemetryFrame[], predicate: (frame: TelemetryFrame) => boolean, laps: number): number[] {
  const hits = new Map<number, Set<number>>();
  for (const frame of frames) if (predicate(frame)) { const bin = Math.floor(frame.lapDistance * 50); const set = hits.get(bin) ?? new Set<number>(); set.add(frame.lap); hits.set(bin, set); }
  return [...hits.entries()].filter(([, lapSet]) => lapSet.size >= Math.min(2, laps)).map(([bin]) => bin);
}
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
