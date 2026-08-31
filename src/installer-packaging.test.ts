import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type JsonObject = Record<string, unknown>;

const legacyInstallerGuid =
  "c3ccacb5-a800-5246-8b4b-d3e78e297f70";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

async function readPackage(): Promise<JsonObject> {
  return JSON.parse(
    await readFile(path.resolve("package.json"), "utf8")
  ) as JsonObject;
}

async function readPackagingWrapper(): Promise<string> {
  return readFile(
    path.resolve("scripts", "package-windows.ps1"),
    "utf8"
  );
}

function buildConfig(packageJson: JsonObject): JsonObject {
  assert.ok(
    isObject(packageJson.build),
    "package.json must contain an electron-builder build configuration"
  );
  return packageJson.build;
}

function nsisConfig(build: JsonObject): JsonObject {
  assert.ok(
    isObject(build.nsis),
    "electron-builder NSIS configuration is required"
  );
  return build.nsis;
}

test(
  "Windows beta packaging declares an explicit x64 NSIS target",
  async () => {
    const build = buildConfig(await readPackage());
    const targets = asArray(
      isObject(build.win) ? build.win.target : undefined
    );
    const nsisTarget = targets.find(
      target => isObject(target) && target.target === "nsis"
    );

    assert.ok(
      isObject(nsisTarget),
      "Windows must include an NSIS target"
    );
    assert.ok(
      Array.isArray(nsisTarget.arch) && nsisTarget.arch.includes("x64"),
      "the NSIS target must explicitly declare x64"
    );
  }
);

test(
  "Windows beta packaging uses a deterministic setup artifact name",
  async () => {
    const build = buildConfig(await readPackage());
    const win = build.win;

    assert.ok(isObject(win));
    assert.equal(
      win.artifactName,
      "Kynolith-Apex-LMU-Coach-${version}-setup.${ext}"
    );
  }
);

test(
  "Windows beta packaging preserves the Apex application identity",
  async () => {
    const build = buildConfig(await readPackage());

    assert.equal(build.appId, "com.kynolith.apex.lmucoach");
    assert.equal(build.productName, "Kynolith Apex LMU Coach");
  }
);

test(
  "Windows beta packaging pins the existing installer upgrade GUID",
  async () => {
    const build = buildConfig(await readPackage());
    const nsis = nsisConfig(build);

    assert.equal(nsis.guid, legacyInstallerGuid);
  }
);

test(
  "Windows beta installer is assisted",
  async () => {
    const build = buildConfig(await readPackage());
    const nsis = nsisConfig(build);

    assert.equal(nsis.oneClick, false);
  }
);

test(
  "Windows beta installer pins per-user installation",
  async () => {
    const build = buildConfig(await readPackage());
    const nsis = nsisConfig(build);

    assert.equal(nsis.perMachine, false);
  }
);

test(
  "Windows beta installer does not request elevation",
  async () => {
    const build = buildConfig(await readPackage());
    const nsis = nsisConfig(build);

    assert.equal(nsis.allowElevation, false);
  }
);

test(
  "Windows beta installer keeps Start Menu and optional Desktop shortcut boundaries",
  async () => {
    const build = buildConfig(await readPackage());
    const nsis = nsisConfig(build);

    assert.equal(nsis.createStartMenuShortcut, true);
    assert.equal(nsis.createDesktopShortcut, false);
    assert.equal(nsis.include, "build/installer.nsh");
  }
);

test(
  "Windows beta uninstall does not delete Electron userData",
  async () => {
    const build = buildConfig(await readPackage());
    const nsis = nsisConfig(build);

    assert.notEqual(nsis.deleteAppDataOnUninstall, true);
  }
);

test(
  "Windows beta packaging retains application file patterns",
  async () => {
    const build = buildConfig(await readPackage());
    const files = Array.isArray(build.files) ? build.files : [];

    for (const pattern of [
      "dist/**/*",
      "public/**/*",
      "electron/**/*",
      "config/**/*",
      "package.json",
      "THIRD_PARTY_NOTICES.md"
    ]) {
      assert.ok(files.includes(pattern), `missing packaged file pattern: ${pattern}`);
    }
  }
);

test(
  "Windows beta packaging retains bridge, model, and manifest resources",
  async () => {
    const build = buildConfig(await readPackage());
    const resources = Array.isArray(build.extraResources)
      ? build.extraResources.filter(isObject)
      : [];

    assert.ok(
      resources.some(
        resource =>
          resource.from === "bridge/publish/Kynolith.LmuBridge.exe" &&
          resource.to === "bridge/Kynolith.LmuBridge.exe"
      ),
      "LMU bridge resource mapping is required"
    );
    assert.ok(
      resources.some(
        resource =>
          resource.from === "offline-models" &&
          resource.to === "models"
      ),
      "offline model resource mapping is required"
    );

    await access(
      path.resolve("config", "bundled-model-manifest.json")
    );
    assert.ok(
      (Array.isArray(build.files) ? build.files : []).includes("config/**/*"),
      "bundled model manifest must be included through config/**/*"
    );
  }
);

test(
  "Windows packaging wrapper selects the canonical NSIS setup artifact",
  async () => {
    const script = await readPackagingWrapper();

    assert.match(
      script,
      /Kynolith-Apex-LMU-Coach-\*-setup\.exe/,
      "wrapper must select the canonical setup artifact"
    );
    assert.doesNotMatch(
      script,
      /--win\s+portable/,
      "wrapper must not request a portable target"
    );
    assert.doesNotMatch(
      script,
      /-portable\.exe/,
      "wrapper must not require a portable artifact"
    );
    assert.match(
      script,
      /electron-builder\s+--win\s+nsis[\s\S]*--publish\s+never/,
      "candidate packaging must explicitly disable electron-builder publishing"
    );
  }
);

test(
  "Windows packaging wrapper rejects zero or multiple setup artifacts",
  async () => {
    const script = await readPackagingWrapper();

    assert.match(
      script,
      /\$artifacts\.Count\s+-ne\s+1/,
      "wrapper must require exactly one setup artifact"
    );
    assert.match(
      script,
      /Expected one NSIS setup artifact/,
      "wrapper must identify zero or multiple setup artifacts deterministically"
    );
  }
);

test(
  "Windows packaging wrapper copies the canonical setup artifact to release",
  async () => {
    const script = await readPackagingWrapper();

    assert.match(
      script,
      /\$destination\s*=\s*Join-Path\s+\$releaseRoot\s+\$artifacts\[0\]\.Name/,
      "wrapper must retain the exact setup artifact name"
    );
    assert.match(
      script,
      /Copy-Item\s+-LiteralPath\s+\$artifacts\[0\]\.FullName\s+-Destination\s+\$destination\s+-Force/,
      "wrapper must copy the selected setup artifact to release"
    );
    assert.match(
      script,
      /Setup build copied to \$destination/,
      "wrapper must report the canonical setup artifact"
    );
  }
);
