# Apex C5C — Corner Diagnosis Authority Design

## Objective

Make the deterministic C1-C4 diagnosis pipeline the single production
source of completed-corner pedal evidence.

C5C diagnoses every completed bounded corner exactly once while preserving
track, vehicle, session, lap, corner, and reference ownership.

C5C does not decide what Apex teaches.
C5C does not generate coaching language.
C5C does not calculate the globally optimal racing line.
Those are downstream responsibilities.

## Existing Authorities

C1:
Deterministic brake-release and throttle-pickup timing.

C2:
Deterministic brake-release and throttle-application shape.

C3:
Structured factual findings with provenance.

C4:
Bounded TrackCorner diagnosis with actual/reference ownership enforcement.

C5A:
Session, actual evidence, and trusted-reference ownership.

C5B:
Coherent reference ingestion and session vehicle-boundary containment.

C5C consumes these authorities rather than recreating them.

## Production Authority Chain

TelemetryFrame
    |
    v
CornerDiagnosisAuthority
    |
    +-- track / vehicle / session / lap ownership
    |
    +-- TrackModel corner geometry
    |
    +-- concurrent bounded corner windows
    |
    +-- trusted reference or no reference
    |
    v
diagnosePedalCorner()
    |
    +-- C1 timing
    +-- C2 shape
    +-- C3 findings
    |
    v
CompletedCornerDiagnosis

## Core Interface

CornerDiagnosisAuthority owns deterministic corner lifecycle state.

Conceptual interface:

    configure({
      model,
      reference
    })

    ingest(frame)
      -> CompletedCornerDiagnosis[]

    reset()

The ingestion result is an array because TrackCorner geometry may overlap.
More than one corner may therefore complete on one telemetry frame.

## Completed Diagnosis Identity

Every completed result must identify:

- track
- vehicle
- session
- lap
- corner id
- corner name
- corner entry
- corner apex
- corner exit
- completed timestamp
- deterministic PedalWindowDiagnosis

The identity tuple:

    track
    vehicle
    session
    lap
    cornerId

may produce at most one completed diagnosis.

## Concurrent Corner Windows

The authority must not assume only one corner can be active.

Active evidence is stored by corner id.

For every telemetry frame:

1. Determine all TrackCorner definitions whose bounded region may own the frame.
2. Start a window when the frame enters a corner.
3. Continue adding frames while the frame belongs to that corner.
4. Close the window when telemetry progresses beyond that corner's exit.
5. Diagnose that completed window exactly once.
6. Continue processing any other simultaneously active windows.

This is required because valid TrackCorner geometry can overlap.

## Evidence Ownership

Every active window belongs to one:

- track
- vehicle
- session
- lap
- corner

If track, vehicle, session, or lap changes before completion:

- discard the incomplete window
- emit no diagnosis from it
- establish new ownership from subsequent telemetry

No mixed-ownership corner may reach C4.

## Completion Law

Before corner entry:
    emit nothing

Inside corner:
    accumulate evidence

First valid frame beyond corner exit:
    close the bounded window
    run deterministic diagnosis exactly once
    emit one CompletedCornerDiagnosis

Additional frames after exit:
    emit nothing for that corner/lap

Next lap:
    the same corner may create one new independent result

## Overlapping Corners

Overlapping geometry must be supported.

If Corner A is active and Corner B begins before Corner A exits:

    Active:
      Corner A
      Corner B

Both receive their own bounded evidence.

Closing Corner A must not discard or alter Corner B.

## Reference Authority

Reference is optional.

A trusted reference may only be used when it has already passed the C5A/C5B
ownership rules.

No reference means exactly:

    no trusted reference authority

C5C must never fabricate an expert, personal-best, or community reference.

When no trusted reference exists:

- valid C2 intrinsic telemetry findings remain available
- trusted-reference findings do not exist
- reference-relative timing remains unavailable

## Nullable Reference Contract

C5C should operate with:

    PedalReferenceInput | null

If necessary, the C4 public boundary may be refined to accept a nullable
reference.

Internally, absence of reference must not be represented by fake provenance.

Any C4 boundary change requires fresh C1-C4 regression verification.

## Configuration Ownership

CornerDiagnosisAuthority is configured for a TrackModel and optional trusted
reference.

Configuration is valid only for the matching track and vehicle ownership.

Changing:

- track
- vehicle
- session ownership
- model
- reference authority

must clear incompatible active windows.

## Reset Boundaries

All incomplete windows must be discarded on:

- telemetry disconnect
- manual session stop
- terminal session
- track change
- vehicle change
- session change
- explicit authority reset

No incomplete evidence may survive these boundaries.

## Track Model Source

C5C consumes TrackModel geometry.

It does not discover track geometry itself.

Curated models remain valid inputs.

Persisted learned models remain valid inputs.

TrackModelStore must provide a read-only live lookup for an existing model
without requiring a completed RecordedSession.

That lookup belongs to the C5C integration seam.

## Server Integration

The production server will own one CornerDiagnosisAuthority instance.

The server must:

1. configure the authority for the current track/car context
2. feed each accepted production TelemetryFrame to it
3. receive zero or more completed deterministic corner diagnoses
4. preserve the latest/results for downstream teaching integration
5. reset the authority on the same lifecycle boundaries used by telemetry
   and pedal-reference ownership

C5C does not yet replace coaching language.

## Coaching Boundary

During C5C:

CoachingEngine remains operational for unrelated existing coaching.

C5C only establishes deterministic production diagnosis.

C5D will remove duplicate pedal factual authority from CornerCoach and
CoachingEngine and prevent reference-relative language unless a real
trusted-reference finding exists.

## First-Lap Track + Vehicle Discovery Boundary

First-lap discovery is a separate follow-on subsystem.

For every previously unseen LMU:

    track + vehicle

combination:

Lap 1 will be used to establish a provisional mathematical track/vehicle
performance model.

The target is not simply the driver's Lap 1.

The model will use observed:

- path
- track geometry evidence
- speed
- braking
- brake release
- throttle application
- steering
- longitudinal/lateral acceleration
- vehicle rotation
- acceleration capability
- available grip evidence

to establish mathematically defensible provisional targets.

Those targets must be available by the beginning of Lap 2.

The model remains provisional and improves as additional valid laps arrive.

C5C must remain compatible with this later source of targets but must not
implement it.

## Adaptive Teaching Priority Boundary

Teaching priority is also downstream of C5C.

C5C diagnoses every corner regardless of current teaching focus.

A5 will calculate actionable time-loss distribution and teach the highest
remaining percentage opportunity.

Improvement in the current focus corner can therefore cause another corner
to become the primary teaching target on the next valid lap.

Focus never causes diagnosis blindness.

## Future Simulator Boundary

LMU is the only release target for the current Apex version.

Future Assetto Corsa support is explicitly out of current scope.

New deterministic Apex core components must consume normalized TelemetryFrame
data rather than LMU-native structures so a later simulator adapter does not
require rewriting diagnosis logic.

## C5C Acceptance Requirements

C5C is accepted only when all of the following are proven:

1. Every completed bounded corner produces at most one deterministic result.
2. The same corner may produce a new result on the next lap.
3. Multiple overlapping corners can be active simultaneously.
4. Completing one overlapping corner does not corrupt another.
5. Track changes discard incomplete evidence.
6. Vehicle changes discard incomplete evidence.
7. Session changes discard incomplete evidence.
8. Lap changes discard incomplete evidence.
9. Disconnect discards incomplete evidence.
10. Manual stop discards incomplete evidence.
11. Terminal session discards incomplete evidence.
12. No-reference operation produces no trusted-reference provenance.
13. Valid intrinsic telemetry findings survive without a trusted reference.
14. A real trusted reference is passed through unchanged.
15. C1-C4 frozen regression tests remain green.
16. Existing session/reference ownership tests remain green.
17. Production server lifecycle tests remain green.
18. Typecheck passes.
19. Build passes.
20. git diff --check passes.

## Non-Goals

C5C does not:

- generate natural-language teaching
- select the primary improvement corner
- calculate actionable-loss percentages
- replace safety or race-control coaching
- implement first-lap optimal-path discovery
- implement Assetto Corsa telemetry
- introduce an LLM into deterministic diagnosis
- create a second progression system