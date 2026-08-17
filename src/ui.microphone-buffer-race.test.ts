import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("finished microphone capture owns its audio buffer before yielding", async () => {
  const source = await readFile("public/app.js", "utf8");

  const finishStart = source.indexOf("const finishTalk=async()=>");

  assert.notEqual(
    finishStart,
    -1,
    "finishTalk must exist",
  );

  const releaseStart = source.indexOf(
    'voiceButton.addEventListener("pointerup"',
    finishStart,
  );

  assert.notEqual(
    releaseStart,
    -1,
    "pointerup wiring must follow finishTalk",
  );

  const finishTalk = source.slice(finishStart, releaseStart);

  const firstAwait = finishTalk.indexOf("await ");

  assert.notEqual(
    firstAwait,
    -1,
    "finishTalk must contain an asynchronous boundary",
  );

  const snapshot =
    finishTalk.indexOf(
      "const completedChunks=audioChunks;audioChunks=[];",
    );

  assert.notEqual(
    snapshot,
    -1,
    "finishTalk must take ownership of completed audioChunks before yielding",
  );

  assert.ok(
    snapshot < firstAwait,
    "completed audio must be detached from shared capture state before the first await",
  );

  assert.match(
    finishTalk,
    /mergeAudio\(completedChunks\)/,
    "finished utterance must merge its private completedChunks buffer",
  );

  assert.doesNotMatch(
    finishTalk,
    /mergeAudio\(audioChunks\)/,
    "finishTalk must not read the shared capture buffer after yielding",
  );
});