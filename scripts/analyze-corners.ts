import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CornerCoach } from "../src/corner-coach.js";
import type { RecordedSession } from "../src/types.js";

const sessionsDir = process.argv[2];
if (!sessionsDir) throw new Error("Pass the Apex sessions directory");
const latest = (await readdir(sessionsDir)).filter(file => /^session-\d+\.json$/.test(file)).sort().at(-1);
if (!latest) throw new Error("No recorded sessions found");
const session = JSON.parse(await readFile(path.join(sessionsDir, latest), "utf8")) as RecordedSession;
const coach = new CornerCoach();
const cues = session.frames.flatMap(frame => coach.ingest(frame, true));
console.log(JSON.stringify({ session: latest, frames: session.frames.length, cornerReviews: cues.filter(cue => cue.id.startsWith("corner-review-")).map(cue => ({ lap: cue.id.split("-").at(-2), message: cue.message })), previews: cues.filter(cue => cue.id.startsWith("corner-preview-")).length }, null, 2));
