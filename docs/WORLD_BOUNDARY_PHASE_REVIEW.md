# World/provenance prerequisite review

Design Reference: OH-30, OH-31, OH-32, OH-43, OH-44, OH-66; issue #26 and the OH-P3 start gate.

## Implemented

### Observation evidence boundary

- Observation schema v3 stores `world`, `provenance` and optional evidence references.
- Invalid enum values, partial boundaries, illegal world/provenance pairs and contradictory Earth source/confidence combinations are rejected.
- Earth state, bounded Brain observation context, semantic understanding, visual opportunity/budget decisions and phone liveness consume only valid Earth evidence.
- Deduplication and hourly usage compaction include world/provenance so virtual records cannot replace real phone evidence.
- Phone HTTP routes reject explicit non-Earth payloads and stamp their own Earth/observed boundary.
- MCP observation writes accept explicit valid worlds and reject illegal evidence pairs.
- Ambiguous legacy observation evidence remains quarantined and cannot drive Earth facts.

### Canonical long-lived semantic records

`DiaryEntry`, `ActionItem`, `RelationshipEvent` and `AgentActivity` now persist explicit `world + provenance` fields.

A separate long-lived-record validator is used instead of weakening the stricter Observation evidence rules. For example:

- `EARTH/authored` is legal for a real-world plan or diary entry;
- `EARTH/authored` is still not valid observed device evidence;
- `EARTH/simulated` is rejected;
- `AI_WORLD/observed` is rejected;
- `FICTION/user_declared` is rejected.

New diary/action/relationship write paths preserve this boundary. Generated activity records inherit the boundary of the record/event that created them rather than inventing a new world.

Relationship approval changes approval state only. User or agent approval cannot rewrite an AI World relationship event into Earth or vice versa.

Compatibility calls that omit both world and provenance are **not guessed into Earth**. They fail closed into `FICTION/authored`. Supplying only one half of the boundary remains an error. New MCP callers are instructed to provide the boundary explicitly.

Seed/mock diary/action/activity data is explicitly classified as Fiction rather than looking like reality.

MCP read surfaces for diary, action, relationship event and activity support an explicit `world` filter so Earth/AI World/Fiction reads can be mechanically isolated instead of relying only on prompt discipline.

### Fixed Earth routine configuration

`RoutineWindow` is explicitly typed and persisted as:

- `world = EARTH`
- `provenance = user_declared`

This is not a free-world record: the existing product contract defines the routine feature as the user's real-life schedule/context. Older boundary-less routine records can therefore be deterministically normalized to the same pair without guessing an ambiguous world.

AI World scheduling must use its own future world-bound model rather than reusing the Earth routine structure.

### Runtime/control-plane classification

`docs/LONG_LIVED_RECORD_BOUNDARY_CLASSIFICATION.md` now distinguishes semantic world records from persisted Runtime mechanics.

The following are persisted for reliability/control flow and are explicitly **not** canonical world memory merely because they live in the store:

- `WakeEvent`
- `WakeEngineState`
- `HeartbeatRecord`
- `ProactiveCandidate`
- `VisualRequestRecord`
- `PhoneDeviceRegistration`

`ProactiveMessage` is classified as a communication/inbox artifact: its existence records that a message was left for the user, but statements inside its body are not Earth evidence.

`HomeState` is classified as a legacy mutable UI/placeholder projection. It is neither the canonical Earth Life State nor the future canonical AI World state and must not be silently promoted to either.

### Other boundary-sensitive runtime behavior

- Pending old wake decisions whose embedded life state predates world filtering are not reused as trusted Earth decisions.
- Proactive notification, visual observation and Care work continue to use Earth Life State rather than AI World/Fiction observation evidence.
- No AI World persistent state machine has been added ahead of this gate.

## Verification

Automated coverage includes:

- Observation boundary validation and cross-world consumer isolation;
- long-lived-record boundary validation separate from evidence validation;
- AI World diary/action persistence without Earth contamination;
- relationship event world/provenance persistence and approval-boundary preservation;
- audit activity inheriting its source record/event boundary;
- illegal long-lived-record pairs failing before persistence;
- legacy/unbounded internal and MCP writes being quarantined as `FICTION/authored` rather than promoted to Earth;
- MCP world-filtered diary/action/relationship/activity reads;
- new RoutineWindow records fixed to `EARTH/user_declared`;
- deterministic normalization of older boundary-less RoutineWindow records to their already-defined Earth/user-declared semantics.

Runtime CI passed on the code head containing relationship and routine boundary coverage. Runtime CI is exposed through temporary validation-only PR #37 because the actual feature line remains stacked; #37 is never a merge target.

No user-installable APK release, production deployment, or provider call is part of this boundary step.

## Issue #26 exit-criteria review

1. **Persisted schema mechanically represents world + provenance where the record is canonical semantic/factual memory — satisfied.**
   Observation evidence and canonical semantic records have explicit boundaries; fixed Earth routines have literal boundaries; operational state is explicitly classified outside canonical memory.

2. **Existing data is handled deterministically and safely — satisfied for the data that exists in this development instance.**
   Observation migration quarantines ambiguous legacy evidence rather than upgrading it to Earth. Old pending decisions derived before filtering are invalidated. RoutineWindow normalization is deterministic because the old feature contract was already Earth/user-declared. There is no meaningful corpus of old user diary/action/relationship/activity data requiring a standalone migration project; compatibility writes fail closed instead of manufacturing Earth truth.

3. **Earth-state derivation consumes only valid Earth evidence — satisfied.**
   AI World/Fiction and quarantined observation records cannot drive Earth Life State or its visual/phone consumers.

4. **Tests prove AI World/Fiction cannot alter Earth facts — satisfied.**
   Cross-world evidence, semantic record, read-filter and downstream-consumer tests cover the boundary.

5. **AI World implementation did not start before the prerequisite was complete — satisfied.**
   No canonical AI World state machine/progression has been introduced yet.

## P3 start decision

The world/provenance persistence prerequisite itself is now complete enough to remove the **world-boundary** blocker on OH-P3.

This does **not** mean OH-P3 is implemented. P3 should start by introducing a new explicit `AI_WORLD` state/history model with deterministic time progression and restart persistence. It must not relabel `HomeState`, inbox messages, Wake events or other Runtime control structures as AI World memory.

Real-device P1/P2 acceptance remains a separate outstanding gate and is not reclassified by this decision.