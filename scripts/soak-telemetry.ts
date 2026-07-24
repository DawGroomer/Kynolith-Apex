import assert from "node:assert/strict";
import { BoundedFramePipeline } from "../src/bounded-frame-pipeline.js";

const minutes = Number(process.argv.find(value => value.startsWith("--minutes="))?.split("=")[1] ?? 60);
const accelerated = process.argv.includes("--accelerated");
const totalFrames = Math.round(minutes * 60 * 67);
let lastTimestamp = 0, orderingErrors = 0;
const startedRss = process.memoryUsage().rss;
const pipeline = new BoundedFramePipeline<{ timestamp: number }>(256, async frame => {
  if (frame.timestamp <= lastTimestamp) orderingErrors++;
  lastTimestamp = frame.timestamp;
});

if (accelerated) {
  for (let index = 1; index <= totalFrames; index++) {
    pipeline.push({ timestamp: index * 15 });
    if (index % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
} else {
  await new Promise<void>(resolve => {
    let index = 0;
    const timer = setInterval(() => { pipeline.push({ timestamp: ++index * 15 }); if (index >= totalFrames) { clearInterval(timer); resolve(); } }, 15);
  });
}
await pipeline.idle();
const metrics = pipeline.snapshot(), rssGrowthMb = (process.memoryUsage().rss - startedRss) / 1024 ** 2;
assert.equal(orderingErrors, 0);
assert.ok(metrics.queued === 0 && !metrics.processing);
if (accelerated) assert.equal(metrics.dropped, 0, "accelerated 67 Hz workload dropped frames");
assert.ok(rssGrowthMb < 128, `RSS grew ${rssGrowthMb.toFixed(1)} MB`);
console.log(JSON.stringify({ minutesSimulated: minutes, accelerated, totalFrames, rssGrowthMb: Number(rssGrowthMb.toFixed(1)), ...metrics }));
