import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarize } from "../src/session-recorder.js";
import { applyCorpusQuality } from "../src/data-quality.js";
import type { RecordedSession } from "../src/types.js";

const args = process.argv.slice(2).filter(argument => argument !== "--");
const directory = args.find(argument => argument !== "--apply");
const apply = args.includes("--apply");
if (!directory) throw new Error("Usage: pnpm data:quality -- <sessions-directory> [--apply]");
const files = (await readdir(directory)).filter(file => /^session-\d+\.json$/.test(file));
const counts = { trusted: 0, limited: 0, quarantined: 0 };
const archive = path.join(directory, "pre-quality-v3-archive");
if (apply) await mkdir(archive, { recursive: true });
const sessions = await Promise.all(files.map(async file => JSON.parse(await readFile(path.join(directory, file), "utf8")) as RecordedSession));
const summaries = applyCorpusQuality(sessions.map(session => summarize(session)));
for (let index = 0; index < files.length; index++) {
  const file = files[index]!, session = sessions[index]!, summary = summaries[index]!;
  const location = path.join(directory, file);
  counts[summary.quality!.status]++;
  if (apply) {
    const backup = path.join(archive, file);
    try { await copyFile(location, backup, 1); } catch { /* Existing immutable backup is retained. */ }
    session.summary = summary;
    await writeFile(location, JSON.stringify(session), "utf8");
  }
}
console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", sessions: files.length, ...counts, directory }, null, 2));
