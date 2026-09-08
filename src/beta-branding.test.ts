import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function readText(relativePath: string): Promise<string> {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

async function readPackage(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
}

test("Beta release metadata is explicit and centralized", async () => {
  const release = await readText("public/app.js");

  assert.match(release, /const\s+APEX_RELEASE\s*=\s*Object\.freeze\(/);
  assert.match(release, /channel:\s*["']BETA["']/);
  assert.match(release, /version:\s*["']0\.3\.1["']/);
  assert.match(release, /dashboardBadge:\s*["']BETA 0\.3\.1["']/);
});

test("dashboard and HUD expose restrained Beta designations", async () => {
  const [html, app] = await Promise.all([
    readText("public/index.html"),
    readText("public/app.js")
  ]);
  const sources = `${html}\n${app}`;

  assert.match(sources, /data-release-badge="dashboard"/);
  assert.match(sources, /data-release-badge="hud"/);
  assert.match(app, /APEX_RELEASE\.dashboardBadge/);
  assert.match(app, /APEX_RELEASE\.hudBadge/);
});

test("Beta setup artifact is distinct without changing application identity", async () => {
  const packageJson = await readPackage();
  const build = packageJson.build;
  const win = build.win;

  assert.equal(packageJson.version, "0.3.1");
  assert.equal(build.appId, "com.kynolith.apex.lmucoach");
  assert.equal(build.productName, "Kynolith Apex LMU Coach");
  assert.equal(
    win.artifactName,
    "Kynolith-Apex-LMU-Coach-${version}-Beta-setup.${ext}"
  );
});

test("Beta packaging preserves the existing Windows and user-data identity", async () => {
  const packageJson = await readPackage();
  const build = packageJson.build;
  const nsis = build.nsis;

  assert.equal(packageJson.private, true);
  assert.equal(nsis.guid, "c3ccacb5-a800-5246-8b4b-d3e78e297f70");
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.allowElevation, false);
  assert.notEqual(nsis.deleteAppDataOnUninstall, true);
});

test("Beta README contains one proprietary license notice", async () => {
  const readme = await readText("README.md");
  const sections = readme
    .split(/^## /m)
    .filter(section => section.startsWith("License\n") || section.startsWith("License\r\n"));

  assert.equal(sections.length, 1);
  assert.match(
    sections[0] ?? "",
    /Kynolith Apex is proprietary software © 2026 Kynolith LLC\./
  );
  assert.match(sections[0] ?? "", /\[LICENSE\]\(LICENSE\)/);
  assert.match(
    sections[0] ?? "",
    /\[THIRD_PARTY_NOTICES\.md\]\(THIRD_PARTY_NOTICES\.md\)/
  );
});
