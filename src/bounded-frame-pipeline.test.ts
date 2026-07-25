import assert from "node:assert/strict";
import test from "node:test";
import { BoundedFramePipeline } from "./bounded-frame-pipeline.js";

test("pipeline serializes consumption and rejects out-of-order frames", async () => {
  const seen: number[] = []; let concurrent = 0, maxConcurrent = 0;
  const pipeline = new BoundedFramePipeline<{ timestamp: number }>(8, async frame => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(resolve => setTimeout(resolve, 2)); seen.push(frame.timestamp); concurrent--;
  });
  pipeline.push({ timestamp: 1 }); pipeline.push({ timestamp: 2 }); pipeline.push({ timestamp: 2 }); pipeline.push({ timestamp: 3 });
  await pipeline.idle();
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(maxConcurrent, 1);
  assert.equal(pipeline.snapshot().outOfOrder, 1);
});

test("pipeline remains bounded and retains fresh frames under pressure", async () => {
  const seen: number[] = [];
  const pipeline = new BoundedFramePipeline<{ timestamp: number }>(3, async frame => { await new Promise(resolve => setTimeout(resolve, 8)); seen.push(frame.timestamp); });
  for (let timestamp = 1; timestamp <= 20; timestamp++) pipeline.push({ timestamp });
  await pipeline.idle();
  assert.ok(pipeline.snapshot().dropped > 0);
  assert.equal(seen.at(-1), 20);
  assert.ok(seen.length <= 4);
});

test("pipeline discards frames that cannot meet the 200 millisecond live deadline", async () => {
  const seen: number[] = [];
  const pipeline = new BoundedFramePipeline<{ timestamp: number }>(8, async frame => {
    seen.push(frame.timestamp);
    if (frame.timestamp === 1) await new Promise(resolve => setTimeout(resolve, 210));
  }, 180);
  pipeline.push({ timestamp: 1 });
  pipeline.push({ timestamp: 2 });
  await pipeline.idle();
  assert.deepEqual(seen, [1]);
  assert.equal(pipeline.snapshot().dropped, 1);
});
