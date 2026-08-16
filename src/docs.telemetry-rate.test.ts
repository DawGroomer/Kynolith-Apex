import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("telemetry design documentation matches the implemented live pipeline", async () => {
  const design = await fs.readFile("DESIGN.md", "utf8");

  assert.doesNotMatch(
    design,
    /20 Hz UI\s*\/\s*100 Hz analysis/i
  );

  assert.match(
    design,
    /approximately 67 Hz/i
  );

  assert.match(
    design,
    /bounded.*ordered telemetry pipeline/i
  );
});
