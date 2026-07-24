import assert from "node:assert/strict";
import test from "node:test";
import { applyRowdyCorner, applyTemper } from "./coach-personality.js";

test("rowdy corner calls stay brief", () => {
  const praise = applyRowdyCorner("Good execution.", true, "corner-clean-1");
  const correction = applyRowdyCorner("Reduce the coast.", false, "corner-review-1");
  assert.match(praise, /Hell yeah|Hot damn|racin'/);
  assert.match(correction, /coasting|brake/);
  assert.ok(praise.split(/\s+/).length <= 6);
  assert.ok(correction.split(/\s+/).length <= 5);
});

test("rowdy regular coaching is enthusiastic", () => {
  assert.match(applyTemper("Hold the line.", 4, "regular"), /Hot damn|hoss|Yeehaw|Lord have mercy/);
  assert.equal(applyTemper("Clean exit.", 4, "positive", true), "Hell yeah! Clean exit.");
});
