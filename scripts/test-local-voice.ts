import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LocalAi } from "../src/local-ai.js";

const ai = new LocalAi(path.resolve(".model-smoke-cache"));
const outputDirectory = path.resolve(".smoke-data");
const outputFile = path.join(outputDirectory, "apex-neural-voice.wav");

try {
  for (const voice of ["am_michael", "am_fenrir", "af_bella"]) {
    await ai.synthesize("Apex voice ready.", voice, 1.1);
  }
  const wav = await ai.synthesize(
    "Apex voice check. Smooth the brake release, open your hands, then build throttle through the exit.",
    "af_heart",
    1.1
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputFile, Buffer.from(wav));
  console.log(JSON.stringify({ neuralVoiceReady: true, outputFile, bytes: wav.byteLength }));
} finally {
  await ai.dispose();
}
