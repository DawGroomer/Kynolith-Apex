# Decision Trees and Flow Charts

## 1. Coaching Frame Processing Flow

1. Receive telemetry frame from LMU or simulator.
2. Update shared state: `state.frame`, `state.connected`, and session tracking.
3. When source is `lmu`:
   - Record raw frame to session recorder.
   - Detect new session and enqueue a welcome cue.
4. Pass frame to `CoachingEngine.ingest(frame)`.
5. Enqueue resulting cues into `CueScheduler`.
6. Select next cue with `CueScheduler.next(frame)`.
7. If a cue is chosen:
   - Apply swearing/temper logic for technique cues.
   - Personalize the cue if driver name is enabled.
   - Determine speech eligibility via `allowedToSpeak()`.
   - Record the cue to session history.
8. Broadcast state and cue payload to connected WebSocket clients.

## 2. Coaching Engine Decision Tree

### Input: Telemetry frame

- If first frame: initialize `lastGuidanceAt`.
- Safety/racecraft triggers (critical or race):
  - Yellow flag transition: emit `yellow`.
  - Car left/right detection: count consecutive `carLeft`/`carRight` frames, emit on 3 detections.
  - Clear left/right detection: count consecutive absence frames, emit on 12 clear frames.
  - Off-track detection: count frames with `offTrackWheels >= 2`, emit `track-edge` on 3.
  - Track limits steps increase after init: emit `track-limits-step`.
  - Lap invalidation event: emit `lap-invalid`.
  - Pit speed overspeed in pits: emit `pit-speed`.
  - When a new lap starts: emit lap info cue.

- Technique triggers (non-active mode only, not in pits):
  - Steering spike if `speedKph > 120`, steering delta > 0.22, and brake < 0.1.
  - Coast detection if previous brake > 0.45, current brake < 0.08, throttle < 0.08, and speed > 70.
  - Throttle stab if previous throttle < 0.2, current throttle > 0.85, and steering > 0.42.
  - Clean exit if previous steering large and current steering small with throttle high.

- Corner coach advice via `CornerCoach.ingest()`.

- Tire condition advice:
  - `hot-tire` if max tire temp > 115.
  - `tire-spread` if temperature spread > 22.

- Periodic coach check-in if enough time passed since last guidance:
  - If brake > 0.18: release smoothness message.
  - Else if steering > 0.3: eyes through corner message.
  - Else if throttle > 0.75: deliberate input message.
  - Else: rhythm-settling message.

- Sort emitted cues by priority.

## 3. Cue Scheduler Decision Flow

### Enqueue()

- Add every cue to the queue.
- If a cue is `technique`, remove all previously queued technique cues first.
- Store the cue by unique `id`.

### Next(frame)

- Remove expired cues.
- Compute `hardPart = brake > 0.15 || |lateralG| > 1.15 || |steering| > 0.5`.
- Filter cues that are not delayed in hard parts.
- Sort candidates by priority score and age.
- Select highest-scoring cue.
- Apply minimum spacing:
  - `critical` cues: no spacing.
  - others: `minimumSpacingMs` (6-30s based on settings).
- If the last spoken time is too recent, return `null`.
- Otherwise remove chosen cue from queue and return it.

## 4. Speech Eligibility Flow

### `allowedToSpeak(cue, config)`

- If `cue.category === "safety"`: return `config.speakSafety`.
- Else if `cue.category === "racecraft"`: return `config.speakRace`.
- Else if `cue.priority === "technique"`: return `config.speakTechnique`.
- Else: return `config.speakInfo`.

### `applyTemper(message, level, seed, positive)`

- If level <= 0: return message.
- If positive: return a gentle prefix for level 2+, otherwise message.
- For non-positive technique:
  - level 1: mild prompt.
  - level 2: strong prompt.
  - level 3: explicit prompt.
- Choose prefix deterministically from `hash(seed)`.

### `personalize(message, driverName)`

- If `driverName` is empty: return original message.
- Otherwise lower-case first char and prepend `driverName, `.

## 5. Main Process Launch Path

- User starts Electron.
- Electron main loads `dist/server.js` and calls `startCoachServer()`.
- The server binds to a dynamic port.
- Electron launches the LMU bridge process and forwards JSON frames to `/api/telemetry`.
- Web UI loads from the local server.

## 6. Recommended flowcharts

- Frame ingest ➜ coaching engine ➜ scheduler ➜ cue selection ➜ speak eligibility
- Safety/racecraft vs technique decision splitting
- Renderer attach and debug launch paths

These notes match the current implementation in `src/server.ts`, `src/coaching.ts`, and `src/cue-scheduler.ts`.
