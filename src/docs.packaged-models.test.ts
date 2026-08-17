import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("packaging documentation describes the required bundled local models", async () => {
  const readme = await fs.readFile("README.md", "utf8");

  assert.doesNotMatch(
    readme,
    /Packaged model files can be staged for offline operation/i
  );

  assert.doesNotMatch(
    readme,
    /optional offline models/i
  );

  assert.doesNotMatch(
    readme,
    /Optional staged local model assets/i
  );

  assert.match(
    readme,
    /Packaged Windows builds require the supported local model bundle/i
  );

  assert.match(
    readme,
    /Before packaging, stage the supported model bundle/i
  );

  assert.match(
    readme,
    /Required local model assets staged for packaging/i
  );
});
