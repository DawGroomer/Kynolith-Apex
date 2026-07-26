import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFujiMcLarenBenchmark, selectFastestCompleteGeometry } from "../src/mylmu-benchmark.js";
import { convertReferenceFile } from "../src/reference-converter.js";
import type { DrivingReference } from "../src/types.js";

const args = process.argv.slice(2).filter(argument => argument !== "--");
const [input, output] = args;
if (!input || !output) throw new Error("Usage: pnpm benchmark:mylmu -- <owned-fuji.duckdb> <benchmark.json>");
const converted = await convertReferenceFile(path.basename(input), await readFile(input)) as DrivingReference;
const geometry = selectFastestCompleteGeometry(converted.frames);
const benchmark = buildFujiMcLarenBenchmark({ ...converted, id: "geometry-source", importedAt: Date.now(), frames: geometry.frames, lapTimeSeconds: geometry.seconds });
await writeFile(output, JSON.stringify(benchmark), "utf8");
console.log(`Built ${benchmark.name} from driver-owned geometry. Target ${benchmark.lapTimeSeconds?.toFixed(3)} seconds.`);
