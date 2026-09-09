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

  const pnpmSetupIndex = workflow.indexOf("uses: pnpm/action-setup@v4");
  const nodeSetupIndex = workflow.indexOf("uses: actions/setup-node@v4");
  assert.ok(pnpmSetupIndex >= 0, "pnpm/action-setup must be configured");
  assert.ok(nodeSetupIndex >= 0, "actions/setup-node must be configured");
  assert.ok(
    pnpmSetupIndex < nodeSetupIndex,
    "pnpm setup must precede setup-node pnpm cache initialization"
  );
  assert.match(workflow, /version:\s*10/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);

  assert.match(workflow, /bundled-model-sources\.json/);
  assert.match(workflow, /onnx-community\/whisper-tiny\.en/);
  assert.match(workflow, /3a6d57ee9c665610614068e8592d8baee0188181/);
  assert.match(workflow, /onnx-community\/Qwen3-0\.6B-ONNX/);
  assert.match(workflow, /da1453100cf3ff33ef56d17983fc7a8648706db6/);
  assert.match(workflow, /onnx-community\/Kokoro-82M-v1\.0-ONNX/);
  assert.match(workflow, /73d73390d733dc015140aae0ccd665e54088a30d/);
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
  const bridgeBuildIndex = workflow.indexOf("pnpm build:bridge");
  const packagingValidationIndex = workflow.indexOf("pnpm validate:packaging");
  const installerBuildIndex = workflow.indexOf("pnpm dist:win");
  assert.ok(bridgeBuildIndex < packagingValidationIndex, "bridge must be built before packaging validation");
  assert.ok(packagingValidationIndex < installerBuildIndex, "packaging validation must precede the installer build");
  assert.match(workflow, /Kynolith-Apex-LMU-Coach-.*-setup\.exe/);
  assert.match(workflow, /github\.sha/);
  assert.match(workflow, /source.*SHA|SHA.*source/i);
  assert.match(workflow, /model.*revision|revision.*provenance/i);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*write/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /DawGroomer\/Kynolith-Apex-Candidate-Build/);
  assert.match(workflow, /visibility.*private|private.*visibility/i);
  assert.match(workflow, /github\.run_id/);
  assert.match(workflow, /candidate-\$\{\{\s*github\.run_id\s*\}\}/);
  assert.match(workflow, /github\.sha/);
  assert.match(workflow, /gh\s+(api|release)/);
  assert.match(workflow, /--draft/);
  assert.match(workflow, /Kynolith-Apex-LMU-Coach-.*-setup\.exe/);
  assert.match(workflow, /candidate-provenance\.json/);
  assert.match(workflow, /--latest[=\s]+false|latest.*false/i);
  assert.doesNotMatch(workflow, /--publish\s+(true|always)|--latest[=\s]+true/i);
  const uploadStepIndex = workflow.indexOf("name: Upload internal draft candidate");
  assert.ok(uploadStepIndex >= 0, "private draft candidate upload step must exist");
  const uploadStep = workflow.slice(uploadStepIndex);
  assert.match(uploadStep, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(uploadStep, /--target\s+\$env:GITHUB_SHA/);
  assert.match(uploadStep, /--draft/);
  assert.match(uploadStep, /--latest=false/);
  assert.match(uploadStep, /INTERNAL APEX CANDIDATE/);
  assert.match(uploadStep, /UNSIGNED/);
  assert.match(uploadStep, /NOT FOR PUBLIC DISTRIBUTION/);
  assert.match(uploadStep, /DawGroomer\/Kynolith-Apex-Candidate-Build/);
  assert.match(uploadStep, /visibility/);
  assert.match(uploadStep, /private/);
  assert.doesNotMatch(workflow.slice(0, uploadStepIndex), /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.doesNotMatch(workflow, /action-gh-release|softprops\/action-gh-release/);
  assert.doesNotMatch(workflow, /release\/create|gh\s+release\s+publish/i);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
});

test("candidate provenance records the actual setup byte size", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /setupSizeBytes\s*=\s*\[Int64\]\s*\$setups\[0\]\.Length/);
});

test("candidate workflow pins the exact .NET SDK authority", () => {
  const globalPath = path.join(repositoryRoot, "global.json");
  const workflow = readFileSync(workflowPath, "utf8");
  assert.ok(existsSync(globalPath), "global.json must pin the candidate .NET SDK");
  const globalConfig = JSON.parse(readFileSync(globalPath, "utf8"));
  assert.match(workflow, /dotnet-version:\s*9\.0\.317/);
  assert.match(workflow, /Expected \.NET SDK 9\.0\.317/);
  assert.equal(globalConfig.sdk?.version, "9.0.317");
  assert.equal(globalConfig.sdk?.rollForward, "disable");
});
