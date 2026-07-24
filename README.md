# Kynolith Apex — LMU Driving Coach

Real-time beginner coaching for Le Mans Ultimate: deterministic local telemetry analysis, race-aware cue prioritization, offline Hugging Face speech recognition, a guarded local Qwen language router, and Kokoro neural speech with a Windows fallback. Apex does not use an online inference API.

## Run the MVP

```powershell
pnpm install
pnpm test
pnpm start
```

Open `http://127.0.0.1:4377`. The dashboard starts with a simulator source so UI and voice can be tested without entering a session. The packaged desktop app automatically starts the embedded LMU bridge and switches to live telemetry when the enabled `LMU.3.8.SharedMemoryMapPlugin.dll` mapping becomes available.

## Architecture

1. **LMU bridge (C#/.NET/Windows):** reads LMU telemetry and scoring shared memory, validates LMU 3.8 structure sizes, and emits schema-versioned frames at approximately 67 Hz.
2. **Coaching core (TypeScript):** reduces high-rate telemetry into explainable events with severity, cooldown, and interruption rules.
   Its priority, expiry, revalidation, and hard-section scheduling model is informed by Crew Chief V4; see `THIRD_PARTY_NOTICES.md`.
3. **Local AI provider:** runs Whisper transcription and a guarded Qwen LMU knowledge router on the driver's machine with no inference API key.
4. **Cockpit client:** dark, glanceable telemetry HUD, local push-to-talk capture, and natural Kokoro neural speech with an automatic Windows fallback.

All driver-facing measurements use American units: miles per hour, gallons, PSI, and degrees Fahrenheit. Internal analysis retains SI precision and converts only at presentation boundaries.

## Session review

Live LMU frames are downsampled to 10 Hz and stored under the desktop application's per-user data directory. When LMU disconnects or changes sessions, Apex creates a review containing lap times, average and maximum MPH, input-smoothness scores, throttle/brake traces, a track map, and every coaching call pinned to its lap and track percentage.

Apex assigns every lap and session a versioned data-quality status: trusted, limited, or quarantined. Only continuous, representative, plausible laps affect progression, setup advice, strategy, and calibration. Limited and quarantined recordings remain visible for diagnosis but cannot inflate smoothness or depress the driver score. Existing recordings can be audited without modification using `pnpm data:quality -- <sessions-directory>`; add `--apply` to archive the original files and migrate their summaries.

Score calibration requires at least 12 unique expert-labelled sessions with broad raw-score coverage. It remains provisional until 30 labels and reports cross-validated error, confidence, and warnings instead of silently treating a small label set as authoritative.

## Local voice

Hold **HOLD TO TALK**, ask a question, then release. Apex uses quantized `onnx-community/whisper-tiny.en` and `onnx-community/Qwen3-0.6B-ONNX` weights locally. Immediate car-status questions are deterministic. Known LMU questions return vetted local guidance; unfamiliar wording is classified by Qwen into an allowed knowledge category, but generated model text is never used as a physics claim. This prevents the compact model from inventing setup ranges, BoP values, or current car state.

Development builds download the weights once into the per-user cache and are offline afterward. Run `pnpm test:local-ai` and `pnpm test:local-voice` to populate and verify the cache. For a release that works offline from its first launch, run `pnpm models:stage` before `pnpm dist:win`. The staged weights are packaged under Electron resources and remote model loading is disabled automatically when the complete bundle is present.

The **Settings** tab persists the selected American Windows voice, volume, rate, pitch, coaching frequency, spoken-call categories, microphone, and push-to-talk bindings. Push-to-talk can be assigned to a wheel/gamepad button or a keyboard key; the default keyboard binding is Space.

## Safety and coaching policy

- Local rules always own yellow flags, pit-speed warnings, unsafe control inputs, and cue throttling.
- Voice output is short and suppressed by cooldowns; a model never controls the car.
- Safety and race-control calls outrank technique and lap-time advice.
- Raw high-rate telemetry remains local. A bounded single-consumer pipeline preserves frame order, applies backpressure, and exposes accepted, processed, dropped, out-of-order, queue-depth, and latency metrics.

## Class A validation

- `pnpm test` includes deterministic coaching tests and a sanitized LMU race-control fixture replay.
- `pnpm test:soak:accelerated` processes one hour of 67 Hz telemetry (241,200 frames) with ordering, drop, queue, latency, and memory assertions.
- `pnpm test:soak` runs the same workload in real time for release-candidate validation.
- Corner comparisons interpolate exact distance boundaries and report uncertainty and confidence.
- Expert-labelled score sets can be imported through `/api/calibration/import`; calibration error is retained for every skill model.
- Tagged GitHub releases are Authenticode signed when the Kynolith certificate and password secrets are configured.

## Community reference import

The Expert Reference Library accepts official LMU `.duckdb` telemetry recordings, MoTeC i2 CSV exports, generic CSV telemetry, and Apex JSON sessions. Apex detects the format, maps channel names and units, preserves provenance, and selects the fastest complete lap. The minimum useful CSV channels are time, speed, and lap distance; throttle and brake are strongly recommended for coaching comparisons. Raw MoTeC `.ld` files must first be exported from MoTeC i2 as CSV because the binary format is proprietary and varies by logger.

To convert a file outside the desktop UI, run:

```powershell
pnpm reference:convert -- "input.duckdb" "reference.json"
```

## Desktop build

Run `pnpm dist:win`. This publishes the self-contained x64 .NET telemetry bridge, verifies its LMU 3.8 structure sizes, compiles the TypeScript server, and packages both into a portable Electron executable under `release/`.
