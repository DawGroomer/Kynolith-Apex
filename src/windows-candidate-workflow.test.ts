import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(
  repositoryRoot,
  ".github",
  "workflows",
  "windows-candidate.yml"
);

test("manual Windows candidate workflow is pinned and internal-only", () => {
  assert.ok(
    existsSync(workflowPath),
    ".github/workflows/windows-candidate.yml must exist"
  );

  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);

  assert.match(workflow, /bundled-model-sources\.json/);
  assert.match(workflow, /onnx-community\/whisper-tiny\.en/);
  assert.match(
    workflow,
    /3a6d57ee9c665610614068e8592d8baee0188181/
  );
  assert.match(workflow, /onnx-community\/Qwen3-0\.6B-ONNX/);
  assert.match(
    workflow,
    /da1453100cf3ff33ef56d17983fc7a8648706db6/
  );
  assert.match(workflow, /onnx-community\/Kokoro-82M-v1\.0-ONNX/);
  assert.match(
    workflow,
    /73d73390d733dc015140aae0ccd665e54088a30d/
  );
  assert.match(workflow, /acquire-models\.mjs/);
  assert.match(workflow, /sha256|SHA-256|Get-FileHash/i);
  assert.match(workflow, /8\s*\/\s*8|eight.*hash|manifest/i);
  assert.match(workflow, /no.*fallback|fallback.*disabled|fail closed/i);
  assert.match(workflow, /pnpm validate:packaging/);
  assert.match(workflow, /8\s*\/\s*8|eight.*hash|manifest/i);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm typecheck/);
  assert.match(workflow, /pnpm build/);
  assert.match(workflow, /pnpm build:bridge/);
  assert.match(workflow, /pnpm dist:win/);
  assert.match(workflow, /Kynolith-Apex-LMU-Coach-.*-setup\.exe/);
  assert.match(workflow, /github\.sha/);
  assert.match(workflow, /source.*SHA|SHA.*source/i);
  assert.match(workflow, /model.*revision|revision.*provenance/i);
  assert.match(workflow, /upload-artifact@v4/);
  assert.doesNotMatch(workflow, /action-gh-release|softprops\/action-gh-release/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
});
