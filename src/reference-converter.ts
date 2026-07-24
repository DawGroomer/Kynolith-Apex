import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { SessionType, TelemetryFrame } from "./types.js";

export type ReferenceFormat = "apex-json" | "lmu-duckdb" | "csv" | "motec-csv";
export interface ConvertedReference {
  name: string;
  track: string;
  vehicle: string;
  frames: TelemetryFrame[];
  provenance: { format: ReferenceFormat; sourceFile: string; driver?: string; channels: string[]; warnings: string[] };
}

const MAX_FRAMES = 100_000;

export async function convertReferenceFile(filename: string, data: Buffer): Promise<unknown> {
  const cleanName = path.basename(filename).slice(0, 180);
  const extension = path.extname(cleanName).toLowerCase();
  if (extension === ".json") return JSON.parse(data.toString("utf8"));
  if (extension === ".duckdb" || extension === ".db") return convertLmuDuckDb(cleanName, data);
  if (extension === ".ld") throw new Error("Raw MoTeC .ld files are not safely portable. In MoTeC i2, export the fastest lap as CSV, then import that CSV here.");
  if (extension === ".csv" || extension === ".txt") return convertCsv(cleanName, data.toString("utf8"));
  throw new Error("Unsupported reference format. Use LMU .duckdb, MoTeC-exported .csv, generic telemetry .csv, or Apex .json.");
}

async function convertLmuDuckDb(filename: string, data: Buffer): Promise<ConvertedReference> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kynolith-reference-"));
  const databasePath = path.join(directory, "reference.duckdb");
  try {
    await writeFile(databasePath, data);
    const database = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
    const connection = await database.connect();
    try {
      const metadataRows = (await connection.runAndReadAll("select key, value from metadata")).getRowObjectsJson() as Array<{ key: string; value: string }>;
      const metadata = Object.fromEntries(metadataRows.map(row => [row.key, row.value]));
      const channelRows = (await connection.runAndReadAll("select channelName, frequency, unit from channelsList")).getRowObjectsJson() as Array<{ channelName: string; frequency: number; unit: string }>;
      const channels = new Map(channelRows.map(row => [row.channelName, row]));
      const tableRows = (await connection.runAndReadAll("select table_name from information_schema.tables where table_schema = 'main'")).getRowObjectsJson() as Array<{ table_name: string }>;
      const tables = new Set(tableRows.map(row => row.table_name));
      for (const required of ["GPS Time", "Lap Dist", "Ground Speed", "Throttle Pos", "Brake Pos"]) {
        if (!channels.has(required)) throw new Error(`LMU recording is missing required channel: ${required}`);
      }
      const names = new Set(channelRows.map(row => row.channelName));
      const read = async (table: string): Promise<number[][]> => {
        if (!tables.has(table)) return [];
        const result = await connection.runAndReadAll(`select * from ${quoteIdentifier(table)}`);
        return result.getRows().map(row => row.map(value => Number(value)));
      };
      const [times, distances, speeds, throttles, brakes, steering, rpm, gears, latG, longG, fuel, tireTemps, tireWear, tirePressure, brakeTemps, lapEvents] = await Promise.all([
        read("GPS Time"), read("Lap Dist"), read("Ground Speed"), read("Throttle Pos"), read("Brake Pos"), read("Steering Pos"),
        read("Engine RPM"), read("Gear"), read("G Force Lat"), read("G Force Long"), read("Fuel Level"), read("TyresCarcassTemp"),
        read("Tyres Wear"), read("TyresPressure"), read("Brakes Temp"), read("Lap"),
      ]);
      const frequency = (name: string) => Number(channels.get(name)?.frequency ?? 0);
      const sample = (rows: number[][], channel: string, time: number, column = 0, fallback = 0) => {
        if (!rows.length) return fallback;
        const start = times[0]?.[0] ?? 0;
        const index = Math.max(0, Math.min(rows.length - 1, Math.round((time - start) * frequency(channel))));
        return rows[index]?.[column] ?? fallback;
      };
      const maxDistance = Math.max(...distances.map(row => row[0] ?? 0));
      if (maxDistance < 100) throw new Error("LMU recording does not contain a usable lap distance trace");
      const track = metadata.TrackName || metadata.TrackLayout || inferTrack(filename);
      const vehicle = metadata.CarName || metadata.CarClass || "Unknown vehicle";
      const startTime = times[0]?.[0] ?? 0;
      const lapAt = (time: number) => {
        let lap = 0;
        for (const event of lapEvents) { if ((event[0] ?? Infinity) > time) break; lap = event[1] ?? lap; }
        return lap;
      };
      const frames = distances.slice(0, MAX_FRAMES).map((row, index): TelemetryFrame => {
        const time = sample(times, "GPS Time", startTime + index / frequency("Lap Dist"));
        const four = (rows: number[][], channel: string, convert = (value: number) => value): [number, number, number, number] =>
          [0, 1, 2, 3].map(column => convert(sample(rows, channel, time, column))) as [number, number, number, number];
        return baseFrame({ timestamp: Math.round(time * 1000), session: sessionType(metadata.SessionType), track, vehicle,
          lap: lapAt(time), lapDistance: Math.max(0, Math.min(1, (row[0] ?? 0) / maxDistance)), speedKph: sample(speeds, "Ground Speed", time),
          throttle: percent(sample(throttles, "Throttle Pos", time)), brake: percent(sample(brakes, "Brake Pos", time)), steering: percentSigned(sample(steering, "Steering Pos", time)),
          rpm: sample(rpm, "Engine RPM", time), gear: eventValueAt(gears, time), lateralG: sample(latG, "G Force Lat", time), longitudinalG: sample(longG, "G Force Long", time),
          fuelLiters: sample(fuel, "Fuel Level", time), tireTempC: four(tireTemps, "TyresCarcassTemp"), tireWear: four(tireWear, "Tyres Wear"),
          tirePressurePsi: four(tirePressure, "TyresPressure", value => channels.get("TyresPressure")?.unit === "kPa" ? value * 0.1450377 : value),
          brakeTempF: four(brakeTemps, "Brakes Temp", value => value * 9 / 5 + 32) });
      });
      return { name: `${metadata.DriverName || "Community"} — ${track}`, track, vehicle, frames,
        provenance: { format: "lmu-duckdb", sourceFile: filename, ...(metadata.DriverName ? { driver: metadata.DriverName } : {}), channels: [...names].sort(), warnings: frames.length === MAX_FRAMES ? ["Recording truncated to 100,000 samples"] : [] } };
    } finally { connection.closeSync(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function convertCsv(filename: string, text: string): ConvertedReference {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex(row => hasAlias(row, ALIASES.time) && hasAlias(row, ALIASES.speed) && (hasAlias(row, ALIASES.distance) || hasAlias(row, ALIASES.lapDistance)));
  if (headerIndex < 0) throw new Error("CSV needs time, speed, and distance columns. MoTeC i2 exports should include Time, Speed, Lap Distance, Throttle, and Brake.");
  const headers = rows[headerIndex]!.map(normalize);
  const units = rows[headerIndex + 1]?.map(cell => cell.trim().toLowerCase()) ?? [];
  const index = (aliases: string[]) => headers.findIndex(value => aliases.some(alias => value === normalize(alias) || value.includes(normalize(alias))));
  const columns = Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) => [key, index(aliases)])) as Record<keyof typeof ALIASES, number>;
  const value = (row: string[], column: number, fallback = 0) => column < 0 ? fallback : finiteNumber(row[column], fallback);
  const raw = rows.slice(headerIndex + (looksLikeUnits(units) ? 2 : 1)).filter(row => row.some(Boolean));
  const distances = raw.map(row => value(row, columns.lapDistance >= 0 ? columns.lapDistance : columns.distance));
  const maxDistance = Math.max(...distances.filter(Number.isFinite));
  const track = preambleValue(rows.slice(0, headerIndex), ["track", "venue", "circuit"]) || inferTrack(filename);
  const vehicle = preambleValue(rows.slice(0, headerIndex), ["vehicle", "car"]) || "Community reference";
  const driver = preambleValue(rows.slice(0, headerIndex), ["driver", "name"]);
  let inferredLap = 0, previousDistance = 0;
  const speedUnit = units[columns.speed] ?? headers[columns.speed] ?? "";
  const timeUnit = units[columns.time] ?? headers[columns.time] ?? "";
  const format: ReferenceFormat = rows.slice(0, headerIndex).flat().some(cell => /motec/i.test(cell)) ? "motec-csv" : "csv";
  const frames = raw.slice(0, MAX_FRAMES).map((row, rowIndex): TelemetryFrame => {
    const distance = distances[rowIndex] ?? 0;
    if (rowIndex && distance < previousDistance * .25 && previousDistance > maxDistance * .75) inferredLap++;
    previousDistance = distance;
    const rawTime = value(row, columns.time, rowIndex / 10);
    const rawSpeed = value(row, columns.speed);
    return baseFrame({ timestamp: Math.round(rawTime * (/ms/.test(timeUnit) ? 1 : 1000)), session: "practice", track, vehicle,
      lap: columns.lap >= 0 ? value(row, columns.lap) : inferredLap, lapDistance: maxDistance > 1.5 ? distance / maxDistance : distance,
      speedKph: /mph/.test(speedUnit) ? rawSpeed * 1.609344 : /m\/s|mps/.test(speedUnit) ? rawSpeed * 3.6 : rawSpeed,
      throttle: percent(value(row, columns.throttle)), brake: percent(value(row, columns.brake)), steering: percentSigned(value(row, columns.steering)),
      gear: value(row, columns.gear), rpm: value(row, columns.rpm), lateralG: value(row, columns.lateralG), longitudinalG: value(row, columns.longitudinalG) });
  }).filter(frame => Number.isFinite(frame.timestamp) && Number.isFinite(frame.speedKph) && frame.lapDistance >= 0 && frame.lapDistance <= 1.05);
  if (frames.length < 50) throw new Error("CSV contains fewer than 50 usable telemetry samples");
  const present = Object.entries(columns).filter(([, column]) => column >= 0).map(([name]) => name);
  const warnings = ["World-position data was not supplied; Apex aligns this reference by lap distance.", ...(frames.length === MAX_FRAMES ? ["Recording truncated to 100,000 samples"] : [])];
  return { name: `${driver || "Community"} — ${track}`, track, vehicle, frames, provenance: { format, sourceFile: filename, ...(driver ? { driver } : {}), channels: present, warnings } };
}

const ALIASES = {
  time: ["time", "timestamp", "session time", "elapsed time"], speed: ["speed", "ground speed", "gps speed", "velocity"],
  distance: ["distance", "total distance"], lapDistance: ["lap distance", "lap dist", "distance into lap"], lap: ["lap", "lap number"],
  throttle: ["throttle", "throttle pos", "accelerator"], brake: ["brake", "brake pos", "brake pedal"], steering: ["steering", "steering pos", "steering angle"],
  gear: ["gear"], rpm: ["rpm", "engine rpm"], lateralG: ["lateral g", "g force lat", "lat accel"], longitudinalG: ["longitudinal g", "g force long", "long accel"],
};

function baseFrame(values: Partial<TelemetryFrame> & Pick<TelemetryFrame, "timestamp" | "session" | "track" | "vehicle" | "lap" | "lapDistance" | "speedKph">): TelemetryFrame {
  return { worldX: 0, worldZ: 0, gear: 0, rpm: 0, throttle: 0, brake: 0, steering: 0, lateralG: 0, longitudinalG: 0, fuelLiters: 0,
    tireTempC: [0, 0, 0, 0], tireWear: [0, 0, 0, 0], tirePressurePsi: [0, 0, 0, 0], brakeTempF: [32, 32, 32, 32],
    position: 0, classPosition: 0, gapAheadSeconds: null, gapBehindSeconds: null, inPits: false, yellowFlag: false, carLeft: false, carRight: false,
    offTrackWheels: 0, trackLimitsSteps: 0, lapInvalidated: false, ...values };
}
function parseCsv(text: string): string[][] { const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false; for (let i = 0; i < text.length; i++) { const c = text[i]!; if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (c === "," && !quoted) { row.push(cell.trim()); cell = ""; } else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; } else cell += c; } row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); return rows; }
function normalize(value: string) { return value.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function hasAlias(row: string[], aliases: string[]) { return row.some(cell => aliases.some(alias => normalize(cell) === normalize(alias) || normalize(cell).includes(normalize(alias)))); }
function finiteNumber(value: string | undefined, fallback = 0) { const parsed = Number(String(value ?? "").replace(/[^0-9eE+.-]/g, "")); return Number.isFinite(parsed) ? parsed : fallback; }
function looksLikeUnits(row: string[]) { return row.some(cell => /^(s|sec|ms|km\/h|kph|mph|m\/s|m|ft|%|rpm|g|deg)$/i.test(cell)); }
function preambleValue(rows: string[][], keys: string[]) { for (const row of rows) { const key = normalize(row[0] ?? ""); if (keys.some(candidate => key === candidate) && row[1]) return row[1].trim().slice(0, 160); const joined = row.join(","); const match = joined.match(new RegExp(`^(?:${keys.join("|")})\\s*[:=]\\s*(.+)$`, "i")); if (match) return match[1]!.trim().slice(0, 160); } return ""; }
function percent(value: number) { return Math.max(0, Math.min(1, Math.abs(value) > 1.5 ? value / 100 : value)); }
function percentSigned(value: number) { return Math.max(-1, Math.min(1, Math.abs(value) > 1.5 ? value / 100 : value)); }
function eventValueAt(rows: number[][], time: number) { let value = 0; for (const row of rows) { if ((row[0] ?? Infinity) > time) break; value = row[1] ?? value; } return value; }
function quoteIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function inferTrack(filename: string) { return path.basename(filename, path.extname(filename)).split(/_[PQR]_\d{4}|[-_]/)[0]!.trim().slice(0, 120) || "Unknown track"; }
function sessionType(value = ""): SessionType { const normalized = value.toLowerCase(); return normalized.includes("qual") ? "qualifying" : normalized.includes("race") ? "race" : "practice"; }
