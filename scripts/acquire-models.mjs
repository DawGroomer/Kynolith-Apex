import { createHash } from "node:crypto";
import { copyFile, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceLockPath = path.join(
  repositoryRoot,
  "config",
  "bundled-model-sources.json"
);
const runtimeManifestPath = path.join(
  repositoryRoot,
  "config",
  "bundled-model-manifest.json"
);
const offlineModelsPath = path.join(repositoryRoot, "offline-models");

function safeRelative(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be non-empty`);
  }

  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.includes("..")
  ) {
    throw new Error(`${field} is unsafe: ${value}`);
  }

  const clean = path.posix.normalize(normalized);
  if (clean === "." || clean.startsWith("../") || clean.includes("/../")) {
    throw new Error(`${field} escapes root: ${value}`);
  }
  return clean;
}

function under(root, relative) {
  const resolved = path.resolve(root, relative);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(rootPrefix)) {
    throw new Error(`Path escapes staging root: ${relative}`);
  }
  return resolved;
}

async function countFiles(root) {
  let count = 0;
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) count += 1;
      else throw new Error(`Unexpected non-file entry: ${full}`);
    }
  }
  await walk(root);
  return count;
}

async function download(entry, stageRoot) {
  const sourcePath = safeRelative(entry.sourcePath, "sourcePath");
  const stagedPath = safeRelative(entry.stagedPath, "stagedPath");
  const target = under(stageRoot, stagedPath);
  await mkdir(path.dirname(target), { recursive: true });

  const url = new URL(
    `https://huggingface.co/${entry.repository}/resolve/${entry.revision}/${sourcePath}?download=true`
  );
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed for ${entry.repository}/${sourcePath}: HTTP ${response.status}`
    );
  }

  const host = new URL(response.url).hostname;
  if (
    host !== "huggingface.co" &&
    !host.endsWith(".huggingface.co") &&
    host !== "hf.co" &&
    !host.endsWith(".hf.co")
  ) {
    throw new Error(`Unexpected download source for ${sourcePath}: ${host}`);
  }

  let bytes = 0;
  const hash = createHash("sha256");
  const digest = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  await pipeline(
    Readable.fromWeb(response.body),
    digest,
    createWriteStream(target, { flags: "wx" })
  );

  const actualHash = hash.digest("hex");
  if (bytes !== entry.bytes) {
    throw new Error(
      `Byte mismatch for ${stagedPath}: expected ${entry.bytes}, got ${bytes}`
    );
  }
  if (actualHash !== entry.sha256.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch for ${stagedPath}: expected ${entry.sha256}, got ${actualHash}`
    );
  }
}

async function validateRuntimeManifest(stageRoot) {
  const manifest = JSON.parse(await readFile(runtimeManifestPath, "utf8"));
  for (const [relative, expected] of Object.entries(manifest.files ?? {})) {
    const target = under(stageRoot, safeRelative(relative, "manifest path"));
    const actual = createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
    if (actual !== expected.toLowerCase()) {
      throw new Error(`Runtime manifest mismatch for ${relative}`);
    }
  }
}

async function main() {
  const lock = JSON.parse(await readFile(sourceLockPath, "utf8"));
  if (!Array.isArray(lock.sources) || lock.sources.length !== 70) {
    throw new Error("Source lock must contain exactly 70 entries");
  }

  const stagedPaths = new Set();
  for (const entry of lock.sources) {
    if (
      !/^[0-9a-f]{40}$/.test(entry.revision) ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0
    ) {
      throw new Error("Malformed source-lock entry");
    }
    const stagedPath = safeRelative(entry.stagedPath, "stagedPath");
    if (stagedPaths.has(stagedPath)) {
      throw new Error(`Duplicate staged path: ${stagedPath}`);
    }
    stagedPaths.add(stagedPath);
  }

  const stageRoot = await mkdtemp(path.join(tmpdir(), "apex-models-"));
  try {
    for (const entry of lock.sources) await download(entry, stageRoot);

    const readme = path.join(offlineModelsPath, "README.md");
    if (!(await stat(readme)).isFile()) {
      throw new Error("offline-models/README.md is missing");
    }
    await copyFile(readme, path.join(stageRoot, "README.md"));

    if (await countFiles(stageRoot) !== 71) {
      throw new Error("Validated bundle must contain exactly 71 files");
    }
    await validateRuntimeManifest(stageRoot);

    const backupRoot = await mkdtemp(path.join(tmpdir(), "apex-models-old-"));
    const oldRoot = path.join(backupRoot, "offline-models");
    let movedOld = false;
    try {
      await rename(offlineModelsPath, oldRoot);
      movedOld = true;
      await rename(stageRoot, offlineModelsPath);
    } catch (error) {
      if (movedOld) await rename(oldRoot, offlineModelsPath);
      throw error;
    } finally {
      await rm(backupRoot, { recursive: true, force: true });
    }
    console.log("Acquired and validated 70 pinned files plus README.");
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

await main();
