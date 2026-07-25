import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFujiMcLarenBenchmark } from "../src/mylmu-benchmark.js";
import { convertReferenceFile } from "../src/reference-converter.js";
import type { DrivingReference } from "../src/types.js";

const args = process.argv.slice(2).filter(argument => argument !== "--");
const [input, output] = args;
if (!input || !output) throw new Error("Usage: pnpm benchmark:mylmu -- <owned-fuji.duckdb> <benchmark.json>");
const converted = await convertReferenceFile(path.basename(input), await readFile(input)) as DrivingReference;
const benchmark = buildFujiMcLarenBenchmark({ ...converted, id: "geometry-source", importedAt: Date.now(), lapTimeSeconds: lapTime(converted.frames) });
await writeFile(output, JSON.stringify(benchmark), "utf8");
console.log(`Built ${benchmark.name} from driver-owned geometry. Target ${benchmark.lapTimeSeconds?.toFixed(3)} seconds.`);

function lapTime(frames: DrivingReference["frames"]): number {
  const groups = new Map<number, DrivingReference["frames"]>();
  for (const frame of frames) { const list = groups.get(frame.lap) ?? []; list.push(frame); groups.set(frame.lap, list); }
  const complete = [...groups.values()].filter(list => list[0]!.lapDistance < .08 && list.at(-1)!.lapDistance > .9);
  const fastest = complete.sort((a, b) => elapsed(a) - elapsed(b))[0];
  if (!fastest) throw new Error("Driver-owned recording has no complete lap for benchmark geometry");
  converted.frames = fastest;
  return elapsed(fastest);
}
function elapsed(frames: DrivingReference["frames"]) { return (frames.at(-1)!.timestamp - frames[0]!.timestamp) / 1000; }
