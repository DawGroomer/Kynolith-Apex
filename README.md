# Kynolith Apex

**A local, real-time driving coach, spotter, and telemetry analyst for Le Mans Ultimate.**

Kynolith Apex helps sim racers progress from clean, repeatable laps to faster race execution. It listens to live LMU shared-memory telemetry, prioritizes time-sensitive race calls, teaches one actionable technique at a time, and builds post-session reviews from evidence it can trust.

**Kynolith Apex 0.3.1 Beta** is prerelease software under active testing.

Apex is designed for Windows and uses American measurements throughout the driver-facing interface: miles per hour, gallons, PSI, and degrees Fahrenheit.

> [!IMPORTANT]
> Apex is a coaching aid. It does not control the vehicle, replace official race control, or override driver judgment.

## Highlights

- Live LMU telemetry through a native .NET shared-memory bridge
- Separate coach and spotter voices with priority-aware, cancellable audio
- Practice, qualifying, and race-aware coaching behavior
- Short corner feedback for braking, steering, throttle, and clean execution
- Yellow, blue, penalty, pit-speed, damage, puncture, weather, and traffic calls
- Spin and impact recognition distinct from ordinary track-limit warnings
- Multiclass closing-rate prediction and overlap spotter logic
- Fuel, tire, brake, virtual-energy, and stint analysis
- Persistent driver profile, academy rank, progression, and focused drills
- Post-session lap tables, telemetry traces, track maps, corner deltas, and cue references
- Personal-best and expert-reference comparison using distance interpolation
- DuckDB, MoTeC CSV, community CSV, and Apex JSON reference import
- Local Whisper speech recognition, guarded local Qwen routing, and Kokoro speech
- No online inference API key required

## How Apex works

```text
Le Mans Ultimate shared memory
            |
            v
Native Windows bridge (approximately 67 Hz)
            |
            v
Bounded, ordered telemetry pipeline
      |             |              |
      v             v              v
Race control   Corner analysis   Session recorder
      |             |              |
      +-------------+--------------+
                    |
                    v
        Priority and workload scheduler
              |               |
              v               v
        Coach / spotter     Review dashboard
```

The real-time coaching path is deterministic. Safety and spotter events outrank technique advice, stale speech can be cancelled, repeated calls are throttled, and noncritical instruction is delayed during high-workload sections.

The local language model does not invent live telemetry or vehicle physics. It only routes unfamiliar questions into vetted LMU knowledge categories; current car-state answers come from deterministic telemetry.

## Coaching modes

### Practice

Apex acts as an instructor. It selects a focused technique goal, watches repeatable corner execution, confirms good braking or acceleration when useful, and explains recurring losses without talking through every turn.

### Qualifying

Speech is reduced. Apex protects preparation laps, limits experimentation during representative runs, and reports only useful delta, tire, and execution information.

### Race

Safety, traffic, flags, damage, energy, and pit-window information take priority. Technique feedback is restricted to repeated errors that materially affect control, pace, or tire life.

## Driver Academy

The academy provides a structured path through five ranks:

1. Rookie
2. Developing
3. Advanced
4. Expert
5. Prodigy

Promotion considers trusted laps, completed sessions, track/car baselines, overall performance, and the weakest skill—not a single fast lap. Each profile includes:

- Braking, throttle, consistency, and pace components
- Current rank and promotion requirements
- A focused drill with measurable success criteria
- Cross-session history and personal bests
- Data-quality and score-confidence disclosures

## Data quality and honest scoring

Every recorded lap and session receives a versioned quality state:

| State | Meaning | Used for progression? |
| --- | --- | --- |
| **Trusted** | Continuous, representative, plausible telemetry | Yes |
| **Limited** | Useful for review but incomplete or low-confidence | No |
| **Quarantined** | Discontinuous, invalid, stationary, or implausible | No |

Apex checks sample count, active-driving percentage, lap-distance coverage, timing continuity, timestamp resets, backward distance jumps, invalid values, speed plausibility, and track/car lap-time outliers.

Limited and quarantined recordings remain visible for diagnosis, but they cannot inflate smoothness, depress progression, or drive setup, strategy, and calibration conclusions. Raw telemetry is preserved during quality migration.

Audit a session directory without changing it:

```powershell
pnpm data:quality -- "C:\path\to\sessions"
```

Apply the migration and archive the original files first:

```powershell
pnpm data:quality -- "C:\path\to\sessions" --apply
```

## Expert calibration

Apex reports calibration status openly:

- **Uncalibrated:** no accepted expert model is active
- **Provisional:** at least 12 unique, representative expert-labelled sessions
- **Validated:** at least 30 labels with acceptable coverage and cross-validated error

Calibration rejects duplicate identifiers, invalid scores, narrow raw-score ranges, implausible slopes, and inconsistent label sets. Models retain leave-one-out error, in-sample error, R-squared, raw coverage, confidence, and warnings. Provisional corrections are bounded and blended conservatively.

## Session review

LMU frames are recorded locally at a reduced review rate. A completed session can include:

- Lap time, average speed, and maximum speed
- Braking and throttle smoothness
- Throttle and brake traces
- Track map and corner zones
- Corner-by-corner reference deltas with confidence ranges
- Theoretical-best lap
- Coaching calls pinned to lap and track position
- Fuel, tire, brake, energy, and repeatability trends
- Trusted, limited, or quarantined quality status with reasons

## Community and expert references

The Expert Reference Library accepts:

- Official LMU `.duckdb` telemetry recordings
- MoTeC i2 CSV exports
- Generic community CSV telemetry
- Apex JSON sessions

Apex detects supported formats, maps common channel names and units, preserves provenance, separates laps, and selects the fastest complete representative lap. CSV references should contain time, speed, and normalized lap distance; throttle and brake channels are strongly recommended.

Raw MoTeC `.ld` files must first be exported from MoTeC i2 as CSV.

Convert a reference from the command line:

```powershell
pnpm reference:convert -- "input.duckdb" "reference.json"
```

## Voice and controls

The Settings tab supports:

- Independent coach and spotter voices
- Voice volume, rate, and pitch
- Coaching frequency and spoken-call categories
- Microphone selection and sensitivity
- Keyboard, wheel, and gamepad push-to-talk bindings
- Coach personality and aggression controls

The Live Coach tab includes **Stop Session** for manually finalizing a recording if LMU remains connected after the activity ends. Apex stays armed and automatically starts a fresh recording when a new practice, qualifying, or race session begins, including race-weekend, online, and co-op transitions.

Hold the configured push-to-talk control, speak, and release it to submit the question. The default keyboard binding is Space.

Local speech uses quantized `onnx-community/whisper-tiny.en` for transcription, a guarded `onnx-community/Qwen3-0.6B-ONNX` knowledge router, and Kokoro neural speech with a Windows voice fallback.

## Privacy and offline operation

- Raw high-rate telemetry stays on the local machine.
- Speech recognition and language routing run locally.
- Apex does not require an OpenAI or other hosted inference API key.
- Packaged Windows builds require the supported local model bundle and run those models from bundled resources without downloading model weights at runtime.
- The application does not automate steering, pedals, or pit-menu input.

Development builds may download model weights once into the per-user cache. Before packaging, stage the supported model bundle:

```powershell
pnpm models:stage
```

## Installation

### Packaged Windows beta application

Install `Kynolith-Apex-LMU-Coach-0.3.1-Beta-setup.exe` through the assisted per-user installer. Kynolith Apex 0.3.1 Beta is prerelease software under active testing. Start Apex before opening LMU. The desktop application launches its embedded bridge and connects automatically when LMU exposes the supported shared-memory mappings.

The current bridge targets LMU 3.8 shared-memory layouts and validates structure sizes before reading data. Unknown layouts are rejected instead of guessed.

## License

Kynolith Apex is proprietary software © 2026 Kynolith LLC. Source availability
does not constitute an open-source license. See [LICENSE](LICENSE) for permitted
uses and restrictions. Third-party components remain subject to their respective
licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Run from source

Requirements:

- Windows 10 or Windows 11, x64
- Node.js 22
- pnpm 10 or newer
- .NET 9 SDK for the native LMU bridge
- Le Mans Ultimate with shared-memory telemetry enabled

```powershell
git clone https://github.com/DawGroomer/Kynolith-Apex.git
cd Kynolith-Apex
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm start
```

Open `http://127.0.0.1:4377`. Source mode starts with a simulator data source so the dashboard and voice pipeline can be tested without entering LMU.

Run the Electron desktop shell during development:

```powershell
pnpm desktop
```

## Build the Windows executable

```powershell
pnpm dist:win
```

The build performs the following work:

1. Publishes the self-contained x64 .NET telemetry bridge
2. Validates LMU telemetry and scoring structure sizes
3. Compiles the TypeScript server
4. Packages the bridge, dashboard, and required local model bundle
5. Writes the Beta NSIS installer under `release/`

Tagged GitHub builds support Authenticode signing when the Kynolith certificate and password secrets are configured.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the TypeScript server in watch mode |
| `pnpm start` | Start the local server |
| `pnpm desktop` | Launch the Electron desktop application |
| `pnpm typecheck` | Run TypeScript validation |
| `pnpm test` | Run deterministic unit and integration tests |
| `pnpm test:soak:accelerated` | Simulate one hour of 67 Hz telemetry |
| `pnpm test:soak` | Run the one-hour telemetry soak in real time |
| `pnpm test:local-ai` | Populate and verify local language models |
| `pnpm test:local-voice` | Populate and verify the local voice pipeline |
| `pnpm build:bridge` | Publish and validate the native LMU bridge |
| `pnpm build` | Compile TypeScript |
| `pnpm models:stage` | Stage offline models for packaging |
| `pnpm dist:win` | Build the Kynolith Apex 0.3.1 Beta Windows installer |

## Validation strategy

The Windows CI pipeline runs:

- TypeScript type checking
- Deterministic coaching and integration tests
- Recorded, sanitized LMU fixture replay
- Accelerated one-hour telemetry soak testing
- Native shared-memory bridge build and layout validation
- Production TypeScript compilation
- Portable Windows packaging

The telemetry pipeline records accepted, processed, dropped, out-of-order, queue-depth, and latency metrics. Reference comparisons use distance interpolation and disclose uncertainty instead of presenting sample-boundary estimates as exact.

## Known limitations

- Windows and Le Mans Ultimate only
- The native bridge is version-sensitive by design
- Raw proprietary MoTeC `.ld` files are not parsed directly
- Calibration requires representative human expert labels; Apex does not fabricate them
- Offline model staging produces a large Windows package
- Apex supplements—but does not replace—LMU flags, mirrors, visual spotters, or driver awareness

## Project structure

```text
bridge/          Native .NET LMU shared-memory bridge
electron/        Electron desktop entry point
public/          Cockpit dashboard and settings interface
scripts/         Packaging, migration, reference, and soak tools
src/             Coaching, telemetry, analysis, voice, and server modules
test/fixtures/   Sanitized LMU telemetry fixtures
offline-models/  Required local model assets staged for packaging
```

## Third-party acknowledgements

The cue scheduler's priority, expiry, revalidation, and hard-section concepts are informed by Crew Chief V4. Apex is an independent application and does not distribute Crew Chief source code. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and dependency notices.

## Status

Kynolith Apex 0.3.1 Beta is under active development and testing. Data-quality status, calibration confidence, and telemetry health are exposed deliberately so drivers can distinguish measured evidence from provisional guidance.

Built by **Kynolith LLC** for drivers who want a coach—not another dashboard.
