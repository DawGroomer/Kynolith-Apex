import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceLockPath = path.join(
  repositoryRoot,
  "config",
  "bundled-model-sources.json"
);

test("pinned model source lock contains the complete reproducibility contract", () => {
  assert.ok(
    existsSync(sourceLockPath),
    "config/bundled-model-sources.json must exist"
  );

  const lock = JSON.parse(readFileSync(sourceLockPath, "utf8")) as {
    sources?: Array<{
      repository?: unknown;
      revision?: unknown;
      sourcePath?: unknown;
      stagedPath?: unknown;
      sha256?: unknown;
      bytes?: unknown;
      role?: unknown;
    }>;
  };

  assert.equal(lock.sources?.length, 70);

  const expected = new Map([
    [
      "onnx-community/whisper-tiny.en",
      "3a6d57ee9c665610614068e8592d8baee0188181"
    ],
    [
      "onnx-community/Qwen3-0.6B-ONNX",
      "da1453100cf3ff33ef56d17983fc7a8648706db6"
    ],
    [
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      "73d73390d733dc015140aae0ccd665e54088a30d"
    ]
  ]);

  const stagedPaths = new Set<string>();
  for (const source of lock.sources ?? []) {
    assert.ok(expected.has(source.repository as string));
    assert.equal(source.revision, expected.get(source.repository as string));
    assert.match(source.revision as string, /^[0-9a-f]{40}$/);
    assert.equal(typeof source.sourcePath, "string");
    assert.equal(typeof source.stagedPath, "string");
    assert.equal(typeof source.bytes, "number");
    assert.equal(typeof source.role, "string");
    assert.match(source.sha256 as string, /^[0-9a-f]{64}$/);
    assert.ok(!stagedPaths.has(source.stagedPath as string));
    stagedPaths.add(source.stagedPath as string);
  }

  assert.deepEqual(
    new Set(lock.sources?.map(source => source.repository)),
    new Set(expected.keys())
  );

  const serialized = readFileSync(sourceLockPath, "utf8");
  assert.doesNotMatch(serialized, /\/main\//i);
  assert.doesNotMatch(serialized, /latest|floating/i);
});
