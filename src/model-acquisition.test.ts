import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const acquisitionPath = path.join(
  repositoryRoot,
  "scripts",
  "acquire-models.mjs"
);

test("model acquisition is pinned, streamed, validated, and fail-closed", () => {
  assert.ok(
    existsSync(acquisitionPath),
    "scripts/acquire-models.mjs must exist"
  );

  const script = readFileSync(acquisitionPath, "utf8");
  assert.match(
    script,
    /copyFile[\s\S]*from\s+["']node:fs\/promises["']/,
    "README preservation must use promise-based copyFile"
  );
  assert.doesNotMatch(
    script,
    /import\s*\{[^}]*copyFile[^}]*\}\s*from\s+["']node:fs["']/,
    "callback-style copyFile must not be imported"
  );
  assert.match(script, /const bundleParent = path\.dirname\(offlineModelsPath\)/);
  assert.equal(
    script.match(/mkdtemp\(\s*path\.join\(bundleParent,/g)?.length,
    2,
    "staging and backup roots must both be under the bundle parent"
  );
  assert.doesNotMatch(
    script,
    /mkdtemp\(path\.join\(tmpdir\(\)/,
    "swap paths must not derive from os.tmpdir()"
  );
  assert.match(script, /let movedOld = false/);
  assert.match(
    script,
    /if \(movedOld\)[\s\S]*rename\(oldRoot, offlineModelsPath\)/,
    "failed replacement must attempt to restore the original bundle"
  );
  assert.match(script, /bundled-model-sources\.json/);
  assert.match(script, /sha256|SHA-256|createHash\(["']sha256/i);
  assert.match(script, /temporary|temp/i);
  assert.match(script, /path traversal|\.\.\/|relative/i);
  assert.match(script, /mismatch|hash.*fail|fail.*hash/i);
  assert.match(script, /missing|not found/i);
  assert.doesNotMatch(script, /\/main\//i);
  assert.doesNotMatch(script, /cache fallback|huggingface cache/i);
  assert.doesNotMatch(script, /update.*hash|rewrite.*hash/i);
});
