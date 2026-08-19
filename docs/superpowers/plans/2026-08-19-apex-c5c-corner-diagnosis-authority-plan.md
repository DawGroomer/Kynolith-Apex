# Apex C5C Corner Diagnosis Authority Implementation Plan

> **For agentic workers:** Execute this plan task-by-task using strict red-green verification. Do not combine tasks or widen scope.

**Goal:** Connect Apex's frozen C1-C4 deterministic pedal diagnosis to the production telemetry lifecycle through one bounded corner evidence authority.

**Architecture:** Introduce a dedicated CornerDiagnosisAuthority that owns concurrent TrackCorner evidence windows and emits at most one CompletedCornerDiagnosis per track/vehicle/session/lap/corner tuple. Reference absence remains explicit rather than fabricated. TrackModelStore gains a read-only live lookup, and server.ts wires the authority into existing telemetry lifecycle boundaries without yet changing coaching language.

**Tech Stack:** TypeScript 5.9, Node.js, tsx, Node test runner, existing TelemetryFrame, TrackModel, PedalReferenceInput, and frozen C1-C4 diagnosis modules.

**Spec:** docs/superpowers/specs/2026-08-19-apex-c5c-corner-diagnosis-authority-design.md

## Global Constraints

- Branch must remain weld/evidence-ownership.
- C5C consumes the frozen C1-C4 diagnosis pipeline.
- Do not change deterministic thresholds without new evidence and explicit approval.
- No fabricated expert, personal-best, or community reference.
- No LLM involvement in deterministic diagnosis.
- Diagnose every completed corner regardless of future teaching focus.
- Support overlapping TrackCorner geometry.
- Preserve exact track, vehicle, session, lap, and corner ownership.
- Incomplete or mixed evidence fails closed.
- CoachingEngine wording remains unchanged until C5D.
- First-lap mathematical track/car discovery belongs to C6.
- Adaptive time-loss teaching priority belongs to A5.
- Assetto Corsa support is explicitly out of current scope.
- New core logic consumes normalized TelemetryFrame data.
- Failed mutation or failed test means stop and inspect.

---

### Task 1: Explicit No-Reference C4 Boundary

**Files:**

- Modify: `src/pedal-window-diagnosis.ts`
- Modify: `src/pedal-window-diagnosis.test.ts`

**Produces:**

~~~ts
diagnosePedalWindow(
  actualFrames: TelemetryFrame[],
  reference: PedalReferenceInput | null
): PedalWindowDiagnosis

diagnosePedalCorner(
  actualFrames: TelemetryFrame[],
  reference: PedalReferenceInput | null,
  corner: TrackCorner
): PedalWindowDiagnosis
~~~

**Required behavior:**

When reference is null:

~~~text
timing.state = actual-only

brake-release timing
    unavailable

throttle-pickup timing
    unavailable

pedal shape
    still calculated from actual telemetry

C3 telemetry findings
    still available

trusted-reference findings
    none
~~~

The implementation must not manufacture an empty expert, personal-best,
or community reference merely to satisfy a function signature.

**RED contract:**

Create a test with valid same-owner actual corner telemetry and no reference.

The test must prove:

- timing is actual-only
- both reference timing facts are unavailable
- deterministic pedal shape still executes
- at least one telemetry-provenance finding may survive when supported
- no finding has trusted-reference provenance
- input telemetry is not mutated

**Execution:**

~~~powershell
pnpm exec tsx --test src/pedal-window-diagnosis.test.ts
~~~

Expected before implementation:

~~~text
FAIL
~~~

Implement the minimum nullable-reference boundary.

Run again:

~~~powershell
pnpm exec tsx --test src/pedal-window-diagnosis.test.ts
~~~

Expected:

~~~text
fail 0
~~~

Then run the frozen diagnosis gate:

~~~powershell
pnpm exec tsx --test src/pedal-diagnosis.test.ts
pnpm exec tsx --test src/driving-diagnosis.test.ts
pnpm exec tsx --test src/pedal-window-diagnosis.test.ts
~~~

Stop immediately if any frozen C1-C4 behavior regresses.

---

### Task 2: Pure CornerDiagnosisAuthority Lifecycle

**Files:**

- Create: `src/corner-diagnosis-authority.ts`
- Create: `src/corner-diagnosis-authority.test.ts`

**Produces:**

~~~ts
export interface CompletedCornerDiagnosis {
  track: string;
  vehicle: string;
  session: SessionType;
  lap: number;
  corner: TrackCorner;
  completedAt: number;
  diagnosis: PedalWindowDiagnosis;
}

export interface CornerDiagnosisConfiguration {
  model: TrackModel;
  reference: PedalReferenceInput | null;
}

export class CornerDiagnosisAuthority {
  configure(
    configuration: CornerDiagnosisConfiguration
  ): void;

  ingest(
    frame: TelemetryFrame
  ): CompletedCornerDiagnosis[];

  reset(): void;
}
~~~

**Internal ownership:**

~~~text
configuration
    TrackModel
    PedalReferenceInput | null

current telemetry owner
    track
    vehicle
    session
    lap

active windows
    Map<cornerId, ActiveCornerWindow>

completed identities
    Set<track|vehicle|session|lap|cornerId>
~~~

An active window owns:

~~~ts
interface ActiveCornerWindow {
  corner: TrackCorner;
  frames: TelemetryFrame[];
}
~~~

The implementation must not modify source TelemetryFrame objects.

**Lifecycle law:**

~~~text
before corner
    ↓
no result

frame enters bounded corner
    ↓
open independent window

inside corner
    ↓
append same-owner telemetry

first same-owner frame beyond exit
    ↓
close window
    ↓
run diagnosePedalCorner exactly once
    ↓
emit CompletedCornerDiagnosis

later frames
    ↓
no duplicate for same identity
~~~

**Overlapping-corner law:**

~~~text
Corner A active
        +
Corner B starts before A exits
        ↓
A and B both remain independently active
        ↓
A closes
        ↓
B remains intact
~~~

One frame may therefore close more than one corner and `ingest()` may return
more than one result.

**Owner-transition law:**

Any change in:

- track
- vehicle
- session
- lap

discards all incomplete windows before new telemetry can own them.

No diagnosis may combine telemetry across an owner transition.

**RED contract must prove all of these cases:**

1. Before corner entry emits no result.
2. Frames inside the corner emit no result.
3. First valid frame beyond exit emits exactly one result.
4. Later frames do not duplicate that result.
5. Same corner on the next lap can emit a new result.
6. Two overlapping corners can be active simultaneously.
7. Closing one overlapping corner does not corrupt the other.
8. A single frame can close multiple overlapping windows.
9. Track change discards an incomplete window.
10. Vehicle change discards an incomplete window.
11. Session change discards an incomplete window.
12. Lap change discards an incomplete window.
13. Explicit reset discards incomplete evidence.
14. No-reference mode retains supported telemetry findings.
15. No-reference mode emits zero trusted-reference findings.
16. Valid trusted reference reaches C4 unchanged.
17. Actual telemetry input is not mutated.
18. Reference input is not mutated.

**RED execution:**

~~~powershell
pnpm exec tsx --test src/corner-diagnosis-authority.test.ts
~~~

Expected initially:

~~~text
FAIL
~~~

because the production authority does not exist yet.

Implement only the lifecycle authority required by the tests.

Run:

~~~powershell
pnpm exec tsx --test src/corner-diagnosis-authority.test.ts
~~~

Expected:

~~~text
fail 0
cancelled 0
~~~

Then run adjacent evidence gates:

~~~powershell
pnpm exec tsx --test src/pedal-diagnosis.test.ts
pnpm exec tsx --test src/driving-diagnosis.test.ts
pnpm exec tsx --test src/pedal-window-diagnosis.test.ts
pnpm exec tsx --test src/evidence-ownership.test.ts
pnpm exec tsx --test src/evidence-ingestion.test.ts
~~~

Stop on any failure.

---

### Task 3: Read-Only Live Track Model Lookup

**Files:**

- Modify: `src/track-model-store.ts`
- Modify: `src/track-model-store.test.ts`

**Produces:**

~~~ts
matching(
  track: string
): Promise<TrackModel | null>
~~~

**Required lookup behavior:**

~~~text
matching(track)
    ↓
curated model exists?
    ↓ yes
return curated model

    ↓ no
persisted learned model exists?
    ↓ yes
return persisted model

    ↓ no
return null
~~~

`matching(track)` must not:

- require a RecordedSession
- discover a new model
- write a new model
- modify an existing model
- mutate caller data

`resolve(session)` should reuse `matching(session.summary.track)` before
attempting discovery from a completed recorded session.

**RED tests:**

Test curated lookup:

~~~text
known curated track
    ↓
matching()
    ↓
returns curated TrackModel
~~~

Test persisted lookup:

~~~text
unknown-but-previously-learned track
    ↓
persisted track-model JSON exists
    ↓
matching()
    ↓
returns stored model
~~~

Test missing lookup:

~~~text
unknown track
no persisted model
    ↓
matching()
    ↓
null
    ↓
no new file created
~~~

Run RED:

~~~powershell
pnpm exec tsx --test src/track-model-store.test.ts
~~~

Implement `matching()` and make `resolve()` reuse it.

Run GREEN:

~~~powershell
pnpm exec tsx --test src/track-model-store.test.ts
~~~

Then run affected track intelligence tests available in the repository.

Stop on any regression.

---

### Task 4: Production Server Integration

**Files:**

- Modify: `src/server.ts`
- Create: `src/server.corner-diagnosis.test.ts`
- Modify an existing server lifecycle test only when a demonstrated regression
  requires the existing contract to be updated.

**Server ownership:**

`startCoachServer()` owns exactly one CornerDiagnosisAuthority.

A new live:

~~~text
track + vehicle + session
~~~

context resolves:

~~~text
existing TrackModel
        +
trusted pedal reference OR null
        ↓
CornerDiagnosisAuthority.configure()
~~~

Every accepted supported-session production frame then participates in:

~~~text
TelemetryFrame
    ↓
existing recorder / graph lifecycle
    ↓
CornerDiagnosisAuthority.ingest(frame)
    ↓
0..N CompletedCornerDiagnosis
~~~

C5C does not yet turn those diagnoses into coaching language.

**Completed-history ownership:**

The server retains a bounded history for later A5 integration.

Maximum:

~~~text
100 CompletedCornerDiagnosis records
~~~

When record 101 is added, the oldest record is removed.

Expose test/read-only access through:

~~~ts
cornerDiagnoses(): CompletedCornerDiagnosis[];
~~~

The accessor must return a new array rather than the server-owned array.

**Reset boundaries:**

Incomplete diagnosis windows must be reset on:

- manual session stop
- telemetry disconnect
- sustained terminal session
- explicit active-profile/session lifecycle reset where telemetry ownership is cleared
- server close

Track, vehicle, session, and lap changes remain protected inside
CornerDiagnosisAuthority itself.

**RED server contract:**

1. Telemetry through `ingestTelemetry()` can produce a completed deterministic corner diagnosis.
2. A completed corner appears only once.
3. Result identity contains the correct track.
4. Result identity contains the correct vehicle.
5. Result identity contains the correct session.
6. Result identity contains the correct lap.
7. Result identity contains the correct corner.
8. No-reference operation contains no trusted-reference finding.
9. Disconnect prevents an incomplete pre-disconnect window from completing after reconnection.
10. Manual stop prevents incomplete evidence leakage.
11. Session transition prevents incomplete evidence leakage.
12. Returned history cannot mutate server-owned history.
13. History never exceeds 100 results.

Write `src/server.corner-diagnosis.test.ts` first.

Run:

~~~powershell
pnpm exec tsx --test src/server.corner-diagnosis.test.ts
~~~

Expected before server integration:

~~~text
FAIL
~~~

Integrate the authority through the existing server lifecycle.

Do not rewrite CoachingEngine or CornerCoach language in this task.

Run focused GREEN:

~~~powershell
pnpm exec tsx --test src/server.corner-diagnosis.test.ts
~~~

Then run existing server lifecycle tests, including profile reset and profile
behavior.

Stop if the production lifecycle regresses.

---

### Task 5: C5C Containment and Freeze

Run focused C5C and frozen evidence tests:

~~~powershell
pnpm exec tsx --test src/corner-diagnosis-authority.test.ts
pnpm exec tsx --test src/pedal-diagnosis.test.ts
pnpm exec tsx --test src/driving-diagnosis.test.ts
pnpm exec tsx --test src/pedal-window-diagnosis.test.ts
pnpm exec tsx --test src/evidence-ownership.test.ts
pnpm exec tsx --test src/evidence-ingestion.test.ts
pnpm exec tsx --test src/track-model-store.test.ts
pnpm exec tsx --test src/server.corner-diagnosis.test.ts
~~~

All focused tests must report:

~~~text
fail 0
cancelled 0
~~~

Run the complete repository suite:

~~~powershell
pnpm test
~~~

Required:

~~~text
fail 0
cancelled 0
~~~

Run compiler verification:

~~~powershell
pnpm typecheck
pnpm build
~~~

Both commands must exit 0.

Run repository integrity:

~~~powershell
git diff --check
git status --short
~~~

Before any C5C implementation commit, inspect the complete diff.

Allowed C5C scope:

~~~text
nullable C4 reference boundary
CornerDiagnosisAuthority
CornerDiagnosisAuthority tests
TrackModelStore read-only matching lookup
TrackModelStore tests
production server diagnosis wiring
server diagnosis tests
C5C design
C5C plan
~~~

Forbidden C5C scope:

~~~text
adaptive teaching priority
actionable time-loss ranking
first-lap mathematical optimizer
Assetto Corsa integration
unrelated renderer/UI work
new LLM diagnosis
CoachingEngine phrase rewrite
new progression system
~~~

C5C may be frozen only after every acceptance requirement in the design is
supported by fresh verification evidence.

After the final implementation commit and push:

~~~powershell
git status --short
git log -1 --oneline
git rev-parse HEAD
git rev-parse origin/weld/evidence-ownership
~~~

The worktree must be clean and local/remote SHAs must match.

---

## Post-C5C Sequence

After C5C is frozen:

~~~text
C5D
    Single factual coaching authority
    Remove duplicate pedal diagnosis
    Gate reference-relative language

C6
    First-lap track + vehicle discovery
    Lap 1 mathematical calibration
    Lap 2 provisional targets
    Continue refining from later valid laps

A5
    Adaptive teaching priority
    Calculate actionable time-loss distribution
    Teach highest current percentage opportunity
    Re-rank after each valid lap
~~~

Do not begin C6 or A5 until C5C is frozen.