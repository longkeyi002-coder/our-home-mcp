# Long-lived record boundary classification

Design Reference: OH-30, OH-31, OH-32 and the OH-P3 start gate.

This document defines which persisted Runtime structures are canonical world records, which are fixed Earth configuration, and which are operational/control-plane state. The goal is to prevent a future AI World implementation from treating every JSON field as factual memory merely because it is persisted.

## Rule

`world + provenance` is mandatory for canonical facts, memories and auditable semantic history. Persistence alone does not make a Runtime control record a world fact.

A control-plane record may reference Earth context without becoming Earth evidence. Conversely, AI World/Fiction semantic records must never enter Earth fact derivation merely because they share the same store.

## Canonical world records

These structures may carry semantic content that can become long-lived memory. They must preserve an explicit world boundary and provenance.

| Structure | Classification | Boundary rule |
|---|---|---|
| `LifeObservation` | canonical evidence record | explicit `world + provenance`; strict observation validator; only valid Earth evidence can derive Earth Life State |
| `DiaryEntry` | canonical semantic record | explicit `world + provenance`; missing legacy/new-call boundary fails closed to `FICTION/authored` |
| `ActionItem` | canonical semantic record | explicit `world + provenance`; status updates preserve the original boundary |
| `RelationshipEvent` | canonical semantic record | explicit `world + provenance`; proposal and approval preserve the original boundary; approval never rewrites the world |
| `AgentActivity` | canonical audit/experience record | explicit `world + provenance`; generated activity inherits the event/record boundary that caused it |

Earth/AI World/Fiction list surfaces for diary, action, relationship event and activity support mechanical `world` filtering. Earth factual consumers must not rely on an unfiltered mixed-world list.

## Fixed Earth user configuration

`RoutineWindow` is not a free-world record. Its product meaning is a user-declared real-life routine used to understand Earth context.

Therefore every routine is fixed to:

- `world = EARTH`
- `provenance = user_declared`

New routines persist those literals. Older boundary-less routine records may be deterministically normalized to the same pair because their existing product contract already defines them as user-declared Earth routine context; no ambiguous fact is being guessed.

If AI World later gains its own schedule/routine system, it must use an AI World structure rather than overloading `RoutineWindow`.

## Runtime control-plane state — not canonical world memory

The following structures are persisted for reliability, delivery, leases, device identity or worker continuity. They are not themselves canonical Earth/AI World facts and must not be admitted directly into semantic memory merely because they persist:

- `WakeEvent`
- `WakeEngineState`
- `HeartbeatRecord`
- `ProactiveCandidate`
- `VisualRequestRecord`
- `PhoneDeviceRegistration`

Examples:

- A `WakeEvent` can embed an Earth Life State snapshot for a bounded decision, but the wake record is a Runtime decision envelope, not new evidence.
- A `VisualRequestRecord` is an authorization/request lifecycle record, not proof that the requested screen content was observed.
- A `PhoneDeviceRegistration` is an authenticated device/control identity, not a user-life fact.
- A `ProactiveCandidate` is a delivery candidate. Its existence is not evidence that its message text is true.

## Communication artifact

`ProactiveMessage` is an Our Home inbox/delivery artifact. Its existence means a message was left for the user; it does **not** promote statements inside the message body into Earth facts.

For P3, Brain/memory code must not consume `ProactiveMessage.message` as canonical factual evidence. If a message refers to an AI World event, the underlying AI World record must carry its own world/provenance boundary; the message is only the communication surface.

No AI World memory implementation should use the inbox as its event store.

## Legacy UI projection

`HomeState` is currently a small mutable UI/placeholder projection (`unknown/sleeping/awake/working/waiting`, note, timestamp). It is not the canonical Earth Life State derived from observations, and it is not yet the canonical AI World state required by OH-P3.

Therefore:

- it must not be consumed as Earth evidence;
- it must not be silently reinterpreted as AI World canonical state;
- P3 must introduce an explicitly world-bound AI World state/history model rather than treating the existing `HomeState` placeholder as sufficient persistent AI life.

## P3 boundary gate

Before OH-P3 implementation begins, the gate is satisfied only when:

1. Earth evidence consumers remain restricted to valid Earth `LifeObservation` evidence;
2. all canonical semantic records above mechanically preserve world/provenance;
3. generated semantic/audit records inherit rather than invent a world boundary;
4. fixed Earth configuration is explicitly typed as such;
5. runtime/control-plane records are documented and excluded from canonical memory ingestion;
6. AI World persistent state is introduced as a new explicit world-bound model, not by relabeling Runtime control state or UI placeholders;
7. cross-world tests prove AI World/Fiction records cannot alter Earth facts.

This classification does not implement OH-P3 by itself. It only defines the safe persistence boundary from which P3 may start.