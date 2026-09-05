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

### New long-lived record boundary

New `DiaryEntry`, `ActionItem` and `AgentActivity` records now persist explicit `world + provenance` fields.

A separate long-lived-record validator is used instead of weakening the stricter Observation evidence rules. For example:

- `EARTH/authored` is legal for a real-world plan or diary entry;
- `EARTH/authored` is still not valid observed device evidence;
- `EARTH/simulated` is rejected;
- `AI_WORLD/observed` is rejected;
- `FICTION/user_declared` is rejected.

New diary/action write paths preserve this boundary, and generated audit/activity entries inherit the boundary of the record or event that created them.

Compatibility calls that omit both world and provenance are **not guessed into Earth**. They fail closed into `FICTION/authored`. Supplying only one half of the boundary remains an error. New MCP callers are instructed to provide the boundary explicitly.

Seed/mock diary/action/activity data is explicitly classified as Fiction rather than looking like reality.

MCP read surfaces for diary, action and activity support an explicit `world` filter so Earth/AI World/Fiction reads can be mechanically isolated instead of relying only on prompt discipline.

### Other boundary-sensitive runtime behavior

- Pending old wake decisions whose embedded life state predates world filtering are not reused as trusted Earth decisions.
- Proactive notification, visual observation and Care work continue to use Earth Life State rather than AI World/Fiction observation evidence.
- No AI World persistent state machine has been added ahead of the P3 gate.

## Verification

Automated coverage includes:

- Observation boundary validation and cross-world consumer isolation;
- long-lived-record boundary validation separate from evidence validation;
- AI World diary/action persistence without Earth contamination;
- audit activity inheriting its source record boundary;
- illegal long-lived-record pairs failing before persistence;
- legacy/unbounded internal and MCP writes being quarantined as `FICTION/authored` rather than promoted to Earth;
- MCP world-filtered diary/action/activity reads.

Runtime CI is used through the temporary validation-only PR #37 because the actual feature PR #36 remains stacked on #35. The temporary PR is never a merge target.

No user-installable APK release, production deployment, or provider call is part of this boundary step.

## Scope and remaining P3 gate

This is **not** a claim that OH-P3 is implemented and it does **not** close issue #26 yet.

For this development instance, there is no meaningful corpus of old user diary/action/activity data requiring a standalone migration project. Therefore the current work focuses on safe new-write/read boundaries and fail-closed compatibility rather than manufacturing a legacy-data migration exercise.

Before canonical AI World persisted state begins, the remaining long-lived domains still need a focused boundary review. In particular, records such as `RelationshipEvent` must not become an unclassified path around the world boundary if they are later consumed as long-term factual memory.

The next bounded step is to finish that new-record boundary review, then re-evaluate issue #26 against the P3 start gate. Actual AI World state/progression starts only after that gate is explicitly satisfied.
