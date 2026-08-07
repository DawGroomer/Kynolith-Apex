import type { TelemetryFrame } from "./types.js";

const simulatorStartedAt = Date.now();

export function simulatedFrame(t = Date.now(), startedAt = simulatorStartedAt): TelemetryFrame {
  const elapsedSeconds = Math.max(0, (t - startedAt) / 1000);
  const phase = elapsedSeconds % 90;
  const corner = Math.sin(phase * 0.38);
  const braking = Math.max(0, Math.sin(phase * 0.7 + 2.4));
  return {
    timestamp: t, session: "practice", track: "Circuit de la Sarthe", vehicle: "Hypercar Prototype",
    lap: Math.floor(elapsedSeconds / 90) + 1, lapDistance: phase / 90,
    worldX: Math.cos(phase / 90 * Math.PI * 2) * 950 + Math.sin(phase / 90 * Math.PI * 6) * 90,
    worldZ: Math.sin(phase / 90 * Math.PI * 2) * 540,
    speedKph: 205 + 92 * Math.cos(phase * 0.38),
    gear: Math.max(1, Math.round(3 + 3 * Math.cos(phase * 0.38))), rpm: 7200 + 1700 * Math.sin(phase),
    throttle: Math.max(0, 1 - braking), brake: braking > 0.7 ? braking : 0, steering: corner * 0.46,
    lateralG: corner * 2.4, longitudinalG: -braking * 2.1, fuelLiters: 71 - phase * 0.06,
    tireTempC: [89 + corner * 3, 91 - corner * 2, 87 + corner, 88 - corner], tireWear: [0.06, 0.06, 0.05, 0.05],
    tirePressurePsi: [26.8, 26.9, 27.1, 27.0], brakeTempF: [845, 850, 790, 795],
    position: 7, classPosition: 4, gapAheadSeconds: 1.8, gapBehindSeconds: 2.4, inPits: false, yellowFlag: false, carLeft: false, carRight: false,
    offTrackWheels: 0, trackLimitsSteps: 0, lapInvalidated: false
  };
}
