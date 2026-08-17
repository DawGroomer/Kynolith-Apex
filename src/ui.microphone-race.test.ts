import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("microphone acquisition cannot begin recording after talk control is released", async () => {
  const source = await readFile("public/app.js", "utf8");

  assert.match(
    source,
    /\btalkRequestId\b/,
    "voice capture needs a request generation distinct from recording state",
  );

  const handlerStart =
    source.indexOf('voiceButton.addEventListener("pointerdown",async e=>');

  assert.notEqual(
    handlerStart,
    -1,
    "voice recording pointerdown handler must exist",
  );

  const finishStart = source.indexOf("const finishTalk=", handlerStart);

  assert.notEqual(
    finishStart,
    -1,
    "finishTalk boundary must exist after recording handler",
  );

  const handler = source.slice(handlerStart, finishStart);

  const acquisition = handler.indexOf(
    "await navigator.mediaDevices.getUserMedia",
  );

  const recordingStart = handler.indexOf("recording=true");

  assert.notEqual(
    acquisition,
    -1,
    "recording handler must acquire the microphone",
  );

  assert.notEqual(
    recordingStart,
    -1,
    "recording handler must eventually enter recording state",
  );

  const beforeAcquire = handler.slice(0, acquisition);
  const afterAcquire = handler.slice(acquisition, recordingStart);

  assert.match(
    beforeAcquire,
    /const requestId=\+\+talkRequestId/,
    "pointerdown must create a new talk request before awaiting microphone acquisition",
  );

  assert.match(
    afterAcquire,
    /if\(requestId!==talkRequestId\)/,
    "resolved microphone acquisition must be rejected when its talk request is stale",
  );

  assert.match(
    afterAcquire,
    /getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/,
    "a stale microphone acquisition must release the stream it just acquired",
  );

  const releaseStart = source.indexOf(
    'voiceButton.addEventListener("pointerup"',
    finishStart,
  );

  const navStart = source.indexOf(
    'document.querySelectorAll(".nav")',
    releaseStart,
  );

  assert.notEqual(releaseStart, -1, "pointerup wiring must exist");
  assert.notEqual(navStart, -1, "voice control wiring boundary must exist");

  const releaseWiring = source.slice(releaseStart, navStart);

  assert.match(
    releaseWiring,
    /talkRequestId\+\+/,
    "release/cancel must invalidate any microphone request still awaiting acquisition",
  );
});