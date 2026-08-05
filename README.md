# Kynolith Apex — LMU Driving Coach

Real-time beginner coaching for Le Mans Ultimate: deterministic local telemetry analysis, race-aware cue prioritization, offline Hugging Face speech recognition, a guarded local Qwen language router, and Kokoro neural speech with a Windows fallback. Apex does not use an online inference API.

## Run the MVP

```powershell
pnpm install
pnpm test
pnpm start
```

Open `http://127.0.0.1:4377`. The dashboard starts with a simulator source so UI and voice can be tested without entering a session. The packaged desktop app automatically starts the embedded LMU bridge and switches to live telemetry when the enabled `LMU.3.8.SharedMemoryMapPlugin.dll` mapping becomes available.

## Debugging in VS Code

This workspace includes `.vscode/launch.json` for debugging:

- `Launch Coach Server (tsx)` — start the server with Node debugger attached.
- `Launch Electron Desktop (Main)` — launch Electron with main process debugging.
- `Attach to Electron Renderer` — attach to the renderer after the app starts.
- `Launch Full Coach Workspace` — start the server and Electron together.
- `Launch Full Coach + Renderer` — start the server, Electron main, and renderer debugger.

Use `Run and Debug` in VS Code to select the profile that matches your workflow.
See `docs/decision-trees.md` for full implementation decision trees and flow charts.

See `docs/reproducibility.md` for exact reproducible build and packaging instructions.

## Packaging prerequisites

Before running `pnpm dist:win`, make sure you have:

- `.NET SDK` available at `.tools\dotnet\dotnet.exe` for bridge publishing.
- `cmake` and Windows build tools for native LMU SDK code if you need `pnpm build:native`.
- LMU SDK headers installed at `C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\Support\SharedMemoryInterface`.
- Staged offline model assets under `offline-models`. Use `pnpm models:stage` after downloading the required models into `.model-smoke-cache\huggingface`.
- A working Electron packaging path, since the portable build expects `process.resourcesPath/bridge/Kynolith.LmuBridge.exe` and `process.resourcesPath/models`.

Run `pnpm validate:packaging` to verify that required build and packaging artifacts are present before packaging.

If you are missing the project-local .NET runtime, run `pnpm bootstrap:dotnet` first.

## Architecture

1. **LMU bridge (C++/Windows):** reads the first-party `LMU_Data` mapping after `LMU_Data_Event`; it compiles against the locally installed Studio 397 headers, which are not copied into this repository.
2. **Coaching core (TypeScript):** reduces high-rate telemetry into explainable events with severity, cooldown, and interruption rules.
   Its priority, expiry, revalidation, and hard-section scheduling model is informed by Crew Chief V4; see `THIRD_PARTY_NOTICES.md`.
3. **Local AI provider:** runs Whisper transcription and a guarded Qwen LMU knowledge router on the driver's machine with no inference API key.
4. **Cockpit client:** dark, glanceable telemetry HUD, local push-to-talk capture, and natural Kokoro neural speech with an automatic Windows fallback.

All driver-facing measurements use American units: miles per hour, gallons, PSI, and degrees Fahrenheit. Internal analysis retains SI precision and converts only at presentation boundaries.

## Session review

Live LMU frames are downsampled to 10 Hz and stored under the desktop application's per-user data directory. When LMU disconnects or changes sessions, Apex creates a review containing lap times, average and maximum MPH, input-smoothness scores, throttle/brake traces, a track map, and every coaching call pinned to its lap and track percentage.

## Local voice

Hold **HOLD TO TALK**, ask a question, then release. Apex uses quantized `onnx-community/whisper-tiny.en` and `onnx-community/Qwen3-0.6B-ONNX` weights locally. Immediate car-status questions are deterministic. Known LMU questions return vetted local guidance; unfamiliar wording is classified by Qwen into an allowed knowledge category, but generated model text is never used as a physics claim. This prevents the compact model from inventing setup ranges, BoP values, or current car state.

Development builds download the weights once into the per-user cache and are offline afterward. Run `pnpm test:local-ai` and `pnpm test:local-voice` to populate and verify the cache. For a release that works offline from its first launch, run `pnpm models:stage` before `pnpm dist:win`. The staged weights are packaged under Electron resources and remote model loading is disabled automatically when the complete bundle is present.

The **Settings** tab persists the selected American Windows voice, volume, rate, pitch, coaching frequency, spoken-call categories, microphone, and push-to-talk bindings. Push-to-talk can be assigned to a wheel/gamepad button or a keyboard key; the default keyboard binding is Space.

## Safety and coaching policy

- Local rules always own yellow flags, pit-speed warnings, unsafe control inputs, and cue throttling.
- Voice output is short and suppressed by cooldowns; a model never controls the car.
- Safety and race-control calls outrank technique and lap-time advice.
- Raw 100 Hz telemetry remains local. The voice session receives only selected cues and summaries.

## Desktop build

Run `pnpm dist:win`. This publishes the self-contained x64 .NET telemetry bridge, verifies its LMU 3.8 structure sizes, compiles the TypeScript server, and packages both into a portable Electron executable under `release/`.
