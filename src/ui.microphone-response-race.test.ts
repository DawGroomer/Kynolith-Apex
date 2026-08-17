import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("older voice responses cannot overwrite a newer driver turn", async () => {
  const source = await readFile("public/app.js", "utf8");

  assert.match(
    source,
    /\bvoiceTurnId=0\b/,
    "voice interaction needs a generation distinct from microphone acquisition state",
  );

  const handlerStart =
    source.indexOf('voiceButton.addEventListener("pointerdown",async e=>');

  assert.notEqual(
    handlerStart,
    -1,
    "voice pointerdown handler must exist",
  );

  const finishStart = source.indexOf(
    "const finishTalk=async()=>",
    handlerStart,
  );

  assert.notEqual(
    finishStart,
    -1,
    "finishTalk must exist after voice acquisition wiring",
  );

  const handler = source.slice(handlerStart, finishStart);

  const acquisition = handler.indexOf(
    "await navigator.mediaDevices.getUserMedia",
  );

  assert.notEqual(
    acquisition,
    -1,
    "voice handler must contain microphone acquisition",
  );

  assert.match(
    handler.slice(0, acquisition),
    /voiceTurnId\+\+/,
    "a new driver talk attempt must supersede older response work before awaiting microphone acquisition",
  );

  const releaseStart = source.indexOf(
    'voiceButton.addEventListener("pointerup"',
    finishStart,
  );

  assert.notEqual(
    releaseStart,
    -1,
    "release wiring must follow finishTalk",
  );

  const finishTalk = source.slice(finishStart, releaseStart);

  const firstAwait = finishTalk.indexOf("await ");

  const responseCapture = finishTalk.indexOf(
    "const responseId=voiceTurnId",
  );

  assert.notEqual(
    responseCapture,
    -1,
    "finishTalk must capture the identity of the voice turn it is processing",
  );

  assert.ok(
    responseCapture < firstAwait,
    "voice response identity must be captured before finishTalk first yields",
  );

  const closeMarker =
    finishTalk.indexOf("await audioContext.close()");

  const transcribeMarker =
    finishTalk.indexOf('fetch("/api/local/transcribe"');

  const emptyTranscriptMarker =
    finishTalk.indexOf("if(!transcription.text)");

  const askMarker =
    finishTalk.indexOf('fetch("/api/local/ask"');

  const answerWriteMarker =
    finishTalk.indexOf('$("cue").textContent=result.answer');

  assert.notEqual(closeMarker, -1, "audio context close must exist");
  assert.notEqual(transcribeMarker, -1, "transcription request must exist");
  assert.notEqual(emptyTranscriptMarker, -1, "empty transcript branch must exist");
  assert.notEqual(askMarker, -1, "question request must exist");
  assert.notEqual(answerWriteMarker, -1, "answer UI write must exist");

  assert.match(
    finishTalk.slice(closeMarker, transcribeMarker),
    /if\(responseId!==voiceTurnId\)return/,
    "a superseded turn must stop before starting transcription",
  );

  assert.match(
    finishTalk.slice(transcribeMarker, emptyTranscriptMarker),
    /if\(responseId!==voiceTurnId\)return/,
    "a stale transcription result must be rejected before updating UI or asking a question",
  );

  assert.match(
    finishTalk.slice(askMarker, answerWriteMarker),
    /if\(responseId!==voiceTurnId\)return/,
    "a stale answer must be rejected before updating UI or speaking",
  );

  const catchStart = finishTalk.lastIndexOf("catch(err)");

  assert.notEqual(
    catchStart,
    -1,
    "finishTalk error handler must exist",
  );

  assert.match(
    finishTalk.slice(catchStart),
    /if\(responseId!==voiceTurnId\)return/,
    "an error from a stale voice turn must not overwrite the current turn status",
  );
});