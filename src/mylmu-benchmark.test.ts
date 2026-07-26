import assert from "node:assert/strict";
import test from "node:test";
import { buildFujiMcLarenBenchmark, selectFastestCompleteGeometry } from "./mylmu-benchmark.js";
import { simulatedFrame } from "./simulator.js";
import type { DrivingReference } from "./types.js";

test("builds a provenance-safe MyLMU benchmark from driver-owned geometry", () => {
  const frames = Array.from({ length: 110 }, (_, index) => ({ ...simulatedFrame(1_000 + index * 1_000), track: "Fuji Speedway", vehicle: "McLaren 720S LMGT3 Evo", lap: 2, lapDistance: index / 109 }));
  const source: DrivingReference = { id: "owned", name: "Owned lap", track: "Fuji Speedway", vehicle: "McLaren 720S LMGT3 Evo", importedAt: 1,
    lapTimeSeconds: 109, provenance: { format: "lmu-duckdb", sourceFile: "owned.duckdb", channels: ["Lap Dist", "Ground Speed"], warnings: [] }, frames };
  const result = buildFujiMcLarenBenchmark(source);
  assert.equal(result.benchmark?.label, "MyLMU Community Benchmark");
  assert.equal(result.benchmark?.geometrySource, "driver-owned-lmu-duckdb");
  assert.deepEqual(result.benchmark?.targetLapRangeSeconds, [101.746, 101.874]);
  assert.equal(result.provenance?.format, "mylmu-community-benchmark");
  assert.ok(Math.abs((result.frames.at(-1)!.timestamp - result.frames[0]!.timestamp) / 1000 - 101.81) < .002);
  assert.equal(result.frames[0]!.worldX, frames[0]!.worldX);
});

test("rejects geometry from a different car or track", () => {
  const frames = Array.from({ length: 100 }, (_, index) => ({ ...simulatedFrame(index * 1_000), track: "Spa", vehicle: "McLaren 720S LMGT3 Evo", lapDistance: index / 99 }));
  assert.throws(() => buildFujiMcLarenBenchmark({ id: "x", name: "x", track: "Spa", vehicle: "McLaren 720S LMGT3 Evo", importedAt: 1, lapTimeSeconds: 99, frames }), /Fuji McLaren/);
});

test("selects one fastest complete lap instead of retiming the entire recording", () => {
  const lap = (number: number, seconds: number) => Array.from({ length: 101 }, (_, index) => ({ ...simulatedFrame(number * 1_000_000 + index * seconds * 10), lap: number, lapDistance: index / 100 }));
  const result = selectFastestCompleteGeometry([...lap(1, 110), ...lap(2, 105), ...lap(3, 20).slice(0, 40)]);
  assert.equal(result.frames.length, 101);
  assert.equal(result.frames[0]!.lap, 2);
  assert.equal(result.seconds, 105);
});
