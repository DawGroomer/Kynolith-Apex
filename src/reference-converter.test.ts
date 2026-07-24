import assert from "node:assert/strict";
import { test } from "node:test";
import { convertCsv, convertReferenceFile } from "./reference-converter.js";

test("converts a MoTeC-style CSV and normalizes American source units", () => {
  const lines = ["MoTeC i2 Export", "Track,Fuji Speedway", "Driver,Fast Driver", "Vehicle,GT3", "Time,Ground Speed,Lap Distance,Throttle Pos,Brake Pos,Gear,Engine RPM", "s,mph,m,%,%,,RPM"];
  for (let index = 0; index < 60; index++) lines.push(`${index / 10},${100 + index},${index * 80},${index % 100},${index % 20},4,7000`);
  const converted = convertCsv("fuji.csv", lines.join("\n"));
  assert.equal(converted.track, "Fuji Speedway");
  assert.equal(converted.vehicle, "GT3");
  assert.equal(converted.provenance.format, "motec-csv");
  assert.ok(Math.abs(converted.frames[0]!.speedKph - 160.9344) < 0.001);
  assert.equal(converted.frames.length, 60);
  assert.equal(converted.frames.at(-1)!.lapDistance, 1);
});

test("raw MoTeC LD files return actionable export guidance", async () => {
  await assert.rejects(() => convertReferenceFile("fast-lap.ld", Buffer.from("binary")), /export the fastest lap as CSV/i);
});

test("unsupported files are rejected", async () => {
  await assert.rejects(() => convertReferenceFile("fast-lap.zip", Buffer.from("data")), /Unsupported reference format/);
});
