# Apex product and systems design

## Coaching contract

Apex is a teacher first and a spotter second. Every call belongs to one lane:

1. **Safety:** flags, pit speed, unsafe rejoin, stopped car, severe damage. Immediate and interrupting.
2. **Racecraft:** traffic class, overlap, defending risk, blue-flag context, pit window. Short and time-sensitive.
3. **Technique:** brake point consistency, release shape, minimum speed, steering smoothness, throttle commitment. Delayed until the car is in a low-workload section.
4. **Car:** tire state, brake state, fuel/energy, balance trend. Report trends, not noisy samples.
5. **Learning:** one focus per stint, evidence after three comparable laps, and a post-stint explanation.

Beginner mode limits active technique goals to one and explains vocabulary on request. Intermediate mode adds corner-specific deltas and racecraft. Advanced mode is intentionally outside the first release.

## Session behavior

- **Practice:** teach one repeatable behavior, compare only valid representative laps, and allow longer explanations on straights or in the garage.
- **Qualifying:** reduce speech, protect tire preparation, state delta only at useful landmarks, and suppress experimentation once a representative lap begins.
- **Race:** safety and traffic dominate; technique calls are limited to repeated errors that materially affect control or tire life.

## Data plane

```text
LMU_Data shared memory (event driven)
        |
        v
Native Windows bridge --> canonical TelemetryFrame --> ring buffer
                                                   |          |
                                                   v          v
                                           deterministic   lap/segment
                                           event detectors  reference model
                                                   \          /
                                                    cue scheduler
                                                          |
                                      +-------------------+------------------+
                                      |                                      |
                                local dashboard                  local voice pipeline
                                                                   |
                                                       Whisper -> guarded LMU Qwen -> Kokoro TTS
```

Raw telemetry stays local. The language model classifies unfamiliar driver wording into a fixed LMU knowledge category; only deterministic telemetry answers and vetted local guidance reach the driver. This minimizes latency, hallucination risk, and data exposure without an online inference API.

## Live implementation milestones

### M1 — runnable coach shell (implemented)

- Simulator data source, cockpit dashboard, WebSocket state stream.
- Technique detectors, cooldowns, priorities, expiry, and hard-section suppression.
- Local Whisper transcription, LMU-grounded Qwen explanations, and Windows speech output.
- Official-header native bridge skeleton and tests.

### M2 — first-party LMU live adapter

- Compile bridge against the installed Studio 397 v1.3 header.
- Map full telemetry and scoring state into `TelemetryFrame` at 20 Hz UI / 100 Hz analysis.
- Detect lifecycle, player index changes, session restarts, and game-version mismatch.
- Add reconnect/backpressure and recorded JSONL fixtures.

### M3 — teaching engine

- Build distance-normalized track maps automatically from clean laps.
- Segment corners by brake/steer/throttle phase rather than hardcoded track coordinates.
- Compare representative laps using distance interpolation and confidence thresholds.
- Select one high-value focus based on time loss, consistency, and driver skill level.

### M4 — endurance/race intelligence

- Multiclass closing-rate and class-relative position model.
- Fuel and virtual-energy projections with uncertainty ranges.
- Read-only LMU localhost REST integration first; pit-menu writes require a separate explicit confirmation mode.
- Post-stint report from native DuckDB telemetry recordings.

## Non-negotiable safeguards

- No vehicle control, automated input, or automated pit-menu mutation by default.
- Never replace official flags, spotter visibility, or driver judgment.
- No coaching call during high steering/braking workload unless it is safety-critical.
- Version every telemetry schema and reject unknown layouts instead of guessing offsets.
- Do not add inference credentials to the client or server; Apex AI runs from local model files.
