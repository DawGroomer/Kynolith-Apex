import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("voice button has one recording pointerdown path", async () => {
  const source = await readFile("public/app.js", "utf8");

  const pointerDownRegistrations = [
    ...source.matchAll(/voiceButton\.addEventListener\("pointerdown"/g),
  ];

  assert.equal(
    pointerDownRegistrations.length,
    2,
    "expected one speech-interruption listener and one microphone recording listener",
  );

  const microphoneAcquisitions = [
    ...source.matchAll(/navigator\.mediaDevices\.getUserMedia\(/g),
  ];

  assert.equal(
    microphoneAcquisitions.length,
    1,
    "expected exactly one microphone acquisition path",
  );

  assert.match(
    source,
    /const device=settings\.microphoneDeviceId\?\{exact:settings\.microphoneDeviceId\}:undefined;/,
    "recording path must preserve configured-microphone selection with system-default fallback",
  );

  assert.match(
    source,
    /e\.stopImmediatePropagation\(\)/,
    "recording handler must prevent a second pointerdown recording path",
  );
});