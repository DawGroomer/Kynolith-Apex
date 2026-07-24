const byId = id => document.getElementById(id);
const button = byId("testMicrophone");
const refreshButton = byId("refreshMicrophones");
const picker = byId("microphoneDeviceId");
const meter = byId("microphoneLevel");
const status = byId("microphoneTestState");
const sensitivity = byId("inputSensitivity");
const sensitivityOutput = byId("inputSensitivityOut");

sensitivity.addEventListener("input", () => { sensitivityOutput.textContent = `${sensitivity.value}x`; });
sensitivity.addEventListener("change", async () => {
  const settings = await fetch("/api/settings").then(readJson);
  await fetch("/api/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...settings, inputSensitivity: Number(sensitivity.value) })
  }).then(readJson);
  status.textContent = `Sensitivity saved at ${sensitivity.value}x. Test the microphone again.`;
});

refreshButton.addEventListener("click", async () => {
  let permissionStream;
  try {
    refreshButton.disabled = true;
    status.textContent = "Requesting microphone access so Windows can reveal every input endpoint...";
    permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await populateMicrophones();
    status.textContent = "Inputs refreshed. Select the Realtek/rear analog microphone, then test it.";
  } catch (error) {
    status.textContent = `Microphone discovery failed: ${error.message}. Check Windows Settings > Privacy & security > Microphone.`;
  } finally {
    permissionStream?.getTracks().forEach(track => track.stop());
    refreshButton.disabled = false;
  }
});

picker.addEventListener("change", async () => {
  await persistSelection(picker.value);
  status.textContent = picker.value
    ? "Input selected and saved. Test it to confirm Apex opens the intended port."
    : "Windows default input selected. Choose a named input to force the rear microphone.";
});

button.addEventListener("click", async () => {
  let stream;
  let context;
  try {
    button.disabled = true;
    const requestedId = picker.value;
    status.textContent = "Listening for five seconds — speak normally into the selected microphone.";
    const deviceId = requestedId ? { exact: requestedId } : undefined;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    const active = stream.getAudioTracks()[0];
    const openedId = active.getSettings().deviceId ?? "";
    context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let highest = 0;
    const finishAt = performance.now() + 5000;
    while (performance.now() < finishAt) {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * Number(sensitivity.value));
      highest = Math.max(highest, level);
      meter.value = level;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const forced = Boolean(requestedId && openedId === requestedId);
    const identity = `${active.label || "Unnamed Windows input"}${forced ? " (forced selection confirmed)" : requestedId ? " (Windows returned a different endpoint)" : " (Windows default)"}`;
    status.textContent = highest > 0.06
      ? `Microphone working: ${identity}. Level is good.`
      : `Microphone opened: ${identity}, but the signal is quiet. Check the rear-jack assignment, mute switch, and Windows input volume.`;
    await persistSelection(requestedId);
  } catch (error) {
    status.textContent = `Microphone error: ${error.message}. The selected endpoint may be disconnected or blocked by Windows.`;
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    await context?.close();
    meter.value = 0;
    button.disabled = false;
  }
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => void populateMicrophones());

async function populateMicrophones() {
  const selected = picker.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput");
  picker.replaceChildren(new Option("System default — not port-specific", ""));
  devices.forEach((device, index) => {
    const label = device.label || `Microphone ${index + 1} — grant access to reveal name`;
    const analogHint = /realtek|rear|back|mic in|analog/i.test(label) ? " — likely analog/rear input" : "";
    picker.add(new Option(`${label}${analogHint}`, device.deviceId));
  });
  if ([...picker.options].some(option => option.value === selected)) picker.value = selected;
}

async function persistSelection(deviceId) {
  const settings = await fetch("/api/settings").then(readJson);
  await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...settings, microphoneDeviceId: deviceId })
  }).then(readJson);
  window.dispatchEvent(new CustomEvent("apex-microphone-selected", { detail: { deviceId } }));
}

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
