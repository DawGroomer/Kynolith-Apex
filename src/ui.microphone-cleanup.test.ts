import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("microphone setup failure releases partially acquired resources", async () => {
  const source = await readFile("public/app.js", "utf8");

  const handlerStart =
    'voiceButton.addEventListener("pointerdown",async e=>';

  const start = source.indexOf(handlerStart);
  assert.notEqual(start, -1, "voice recording pointerdown handler must exist");

  const finishStart = source.indexOf("const finishTalk=", start);
  assert.notEqual(
    finishStart,
    -1,
    "finishTalk boundary must exist after recording handler",
  );

  const handler = source.slice(start, finishStart);

  assert.match(
    handler,
    /catch\(err\)\{[\s\S]*getTracks\(\)[\s\S]*stop\(\)/,
    "recording setup catch must stop an already-acquired microphone stream",
  );

  assert.match(
    handler,
    /catch\(err\)\{[\s\S]*audioContext[^;]*close\(\)/,
    "recording setup catch must close an already-created AudioContext",
  );

  assert.match(
    handler,
    /catch\(err\)\{[\s\S]*recording=false/,
    "recording setup catch must leave capture state inactive",
  );
});