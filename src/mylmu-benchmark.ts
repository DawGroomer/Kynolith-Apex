import type { CommunityBenchmarkMetadata, DrivingReference, TelemetryFrame } from "./types.js";

const FUJI_METERS = 4_563;

export const FUJI_MCLAREN_MYLMU: Omit<CommunityBenchmarkMetadata, "geometryLapSeconds"> = {
  type: "mylmu-community-benchmark",
  label: "MyLMU Community Benchmark",
  driver: "Mathis Delattre",
  sourceUrl: "https://mylmu.app/dashboard/telemetry/leaderboard?track=Fuji+Speedway&category=LMGT3",
  observedAt: "2026-07-25",
  geometrySource: "driver-owned-lmu-duckdb",
  targetLapSeconds: 101.81,
  targetLapRangeSeconds: [101.746, 101.874],
  sectors: [
    { sector: 1, seconds: 36.774, rangeSeconds: [36.71, 36.84] },
    { sector: 2, seconds: 27.58, rangeSeconds: [27.52, 27.64] },
    { sector: 3, seconds: 37.46, rangeSeconds: [37.39, 37.53] },
  ],
  targets: [
    target("fuji-t1", -37.2, 7.2, -15.4),
    target("fuji-coca-cola", -15.2, 21),
    target("fuji-100r", 28.2, 0, -140.7, "low"),
    target("fuji-hairpin", 23.8, 20.5, -33.4),
    target("fuji-300r", -12.4, 0, -79.3, "low"),
    target("fuji-dunlop", 10.6, 12),
    target("fuji-t10", -10.8, 3.7),
    target("fuji-t11", 27.8, -11.1, 3.9, "low"),
  ],
  warnings: [
    "The expert trace is viewer-derived and was not downloaded from MyLMU.",
    "Continuous geometry comes from Will Harris's driver-owned LMU recording.",
    "Corner targets are bounded observations, not exact raw expert samples.",
    "Leaderboard and viewer lap displays differed by 0.064 seconds at capture time.",
  ],
};

export function buildFujiMcLarenBenchmark(base: DrivingReference): DrivingReference {
  const compatibleMcLaren = /mclaren 720s/i.test(base.vehicle) || /garage 59 2026 #10/i.test(base.vehicle);
  if (!/fuji/i.test(base.track) || !compatibleMcLaren) throw new Error("The MyLMU Fuji benchmark requires a Fuji McLaren 720S LMGT3 recording");
  if (!base.frames.length || base.lapTimeSeconds == null || base.lapTimeSeconds < 90) throw new Error("The geometry source needs one complete representative lap");
  const metadata: CommunityBenchmarkMetadata = { ...FUJI_MCLAREN_MYLMU, geometryLapSeconds: base.lapTimeSeconds };
  const start = base.frames[0]!.timestamp;
  const scale = metadata.targetLapSeconds / base.lapTimeSeconds;
  const frames = base.frames.map(frame => transformFrame(frame, base.frames, metadata, start, scale));
  return {
    ...base,
    id: `reference-mylmu-fuji-mclaren-${Date.now().toString(36)}`,
    name: "MyLMU Community Benchmark // Mathis Delattre // Fuji McLaren",
    importedAt: Date.now(),
    lapTimeSeconds: metadata.targetLapSeconds,
    provenance: {
      format: "mylmu-community-benchmark",
      sourceFile: base.provenance?.sourceFile ?? "driver-owned-fuji.duckdb",
      driver: metadata.driver,
      channels: base.provenance?.channels ?? [],
      warnings: metadata.warnings,
    },
    benchmark: metadata,
    frames,
  };
}

function transformFrame(frame: TelemetryFrame, base: TelemetryFrame[], metadata: CommunityBenchmarkMetadata, start: number, scale: number): TelemetryFrame {
  const target = metadata.targets.find(item => inCorner(item.cornerId, frame.lapDistance));
  let brake = frame.brake, throttle = frame.throttle, speedKph = frame.speedKph;
  if (target) {
    if (target.brakeShiftMeters) brake = sampleAt(base, frame.lapDistance - target.brakeShiftMeters.midpoint / FUJI_METERS).brake;
    if (target.fullThrottleShiftMeters) throttle = sampleAt(base, frame.lapDistance - target.fullThrottleShiftMeters.midpoint / FUJI_METERS).throttle;
    if (target.minimumSpeedGainKph && nearApex(target.cornerId, frame.lapDistance)) speedKph = Math.max(0, speedKph + target.minimumSpeedGainKph.midpoint);
  }
  return { ...frame, timestamp: Math.round(start + (frame.timestamp - start) * scale), speedKph, brake, throttle };
}

function target(cornerId: string, brakeMeters?: number, speedKph?: number, throttleMeters?: number, confidence: "low" | "moderate" = "moderate") {
  const spread = confidence === "low" ? 12 : 6;
  return { cornerId, confidence,
    ...(brakeMeters === undefined ? {} : { brakeShiftMeters: { midpoint: brakeMeters, range: [brakeMeters - spread, brakeMeters + spread] as [number, number] } }),
    ...(speedKph === undefined ? {} : { minimumSpeedGainKph: { midpoint: speedKph, range: [speedKph - 3, speedKph + 3] as [number, number] } }),
    ...(throttleMeters === undefined ? {} : { fullThrottleShiftMeters: { midpoint: throttleMeters, range: [throttleMeters - spread, throttleMeters + spread] as [number, number] } }),
  };
}

const zones: Record<string, [number, number, number]> = {
  "fuji-t1": [.115, .165, .195], "fuji-coca-cola": [.245, .285, .315], "fuji-100r": [.315, .375, .415],
  "fuji-hairpin": [.415, .445, .475], "fuji-300r": [.515, .545, .565], "fuji-dunlop": [.565, .625, .655],
  "fuji-t10": [.655, .69, .715], "fuji-t11": [.71, .745, .775],
};
function inCorner(id: string, distance: number) { const zone = zones[id]; return !!zone && distance >= zone[0] && distance <= zone[2]; }
function nearApex(id: string, distance: number) { const zone = zones[id]; return !!zone && Math.abs(distance - zone[1]) <= .018; }
function sampleAt(frames: TelemetryFrame[], distance: number): TelemetryFrame { return frames.reduce((best, frame) => Math.abs(frame.lapDistance - distance) < Math.abs(best.lapDistance - distance) ? frame : best, frames[0]!); }
