import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("rail navigation keeps one bounded workspace active without document anchors", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(path.join(repositoryRoot, "public/index.html"), "utf8"),
    readFile(path.join(repositoryRoot, "public/app.js"), "utf8"),
    readFile(path.join(repositoryRoot, "public/styles.css"), "utf8"),
  ]);

  for (const view of ["live", "profile", "review", "race", "setup", "settings"]) {
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, new RegExp(`id="${view}View"`));
  }

  assert.match(html, /id="mainWorkspace"/);
  assert.match(app, /function setActiveView\(view\)/);
  assert.match(app, /activeView===view/);
  assert.match(app, /element\.scrollTop=0/);
  assert.match(app, /workspace\.scrollTop=0/);
  assert.doesNotMatch(app, /href="#(?:live|profile|review|race|setup|settings)/);
  assert.match(styles, /\.view\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/);
  assert.match(styles, /#mainWorkspace[^{]*\{[^}]*overflow:\s*hidden/);

  execFileSync(process.execPath, ["--check", path.join(repositoryRoot, "public/app.js")], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
});
