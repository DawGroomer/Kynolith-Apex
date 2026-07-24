import type { RecordedSession, StrategyReport, TelemetryFrame } from "./types.js";

const LITERS_TO_GALLONS = .2641720524;

export function analyzeStrategy(session: RecordedSession): StrategyReport {
  const complete = session.summary.laps.filter(lap => lap.complete && lap.durationSeconds > 20);
  const samples = complete.map(lap => lapSample(session.frames.filter(frame => frame.lap === lap.lap), lap.durationSeconds)).filter((value): value is LapSample => value !== null);
  if (samples.length < 2) return { status: "insufficient-data", completedLaps: samples.length, fuelPerLapGallons: null, estimatedLapsRemaining: null,
    tireWearPerLapPercent: null, paceTrendSecondsPerLap: null, projectedStintLaps: null, recommendation: "Complete two representative laps to establish fuel and tire trends." };
  const fuelPerLapLiters = average(samples.map(sample => sample.fuelUsedLiters).filter(value => value > .05));
  const fuelRemaining = samples.at(-1)!.fuelRemainingLiters;
  const estimatedLapsRemaining = fuelPerLapLiters > .05 ? fuelRemaining / fuelPerLapLiters : null;
  const tireWearPerLapPercent = average(samples.map(sample => sample.tireWearPercent).filter(value => value >= 0));
  const paceTrendSecondsPerLap = trend(samples.map(sample => sample.lapSeconds));
  const projectedStintLaps = tireWearPerLapPercent > .01 ? 100 / tireWearPerLapPercent : null;
  const status = estimatedLapsRemaining !== null && estimatedLapsRemaining < 2 ? "pit-risk" : paceTrendSecondsPerLap > .8 || tireWearPerLapPercent > 2 ? "watch" : "stable";
  const recommendation = status === "pit-risk" ? "Fuel range is below two laps. Plan to pit this lap."
    : paceTrendSecondsPerLap > .8 ? "Pace is degrading. Protect exits and reassess tires before changing strategy."
      : tireWearPerLapPercent > 2 ? "Tire degradation is elevated. Reduce sliding and compare the next two laps."
        : "Stint trend is stable. Maintain the current pace and preparation.";
  return { status, completedLaps: samples.length, fuelPerLapGallons: fuelPerLapLiters > .05 ? fuelPerLapLiters * LITERS_TO_GALLONS : null,
    estimatedLapsRemaining, tireWearPerLapPercent, paceTrendSecondsPerLap, projectedStintLaps, recommendation };
}

interface LapSample { fuelUsedLiters: number; fuelRemainingLiters: number; tireWearPercent: number; lapSeconds: number; }
function lapSample(frames: TelemetryFrame[], lapSeconds: number): LapSample | null {
  if (frames.length < 20) return null;
  const first = frames[0]!, last = frames.at(-1)!;
  const startWear = average(first.tireWear), endWear = average(last.tireWear);
  return { fuelUsedLiters: Math.max(0, first.fuelLiters - last.fuelLiters), fuelRemainingLiters: last.fuelLiters,
    tireWearPercent: Math.max(0, (startWear - endWear) * 100), lapSeconds };
}
function trend(values: number[]): number { if (values.length < 2) return 0; return (values.at(-1)! - values[0]!) / (values.length - 1); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
