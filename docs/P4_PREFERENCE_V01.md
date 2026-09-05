# P4.2 — Interest Evidence + Bounded Preference State

Design Reference: OH-03, OH-20, OH-21, OH-22, OH-30, OH-31, OH-32, OH-65, OH-P4.

## Purpose

P4.2 adds a traceable deterministic preference precursor. It does **not** implement Soul or personality mutation.

The Runtime can now preserve explicit AI World interest evidence and derive a bounded long-lived preference score while retaining the evidence trail that explains why the score exists.

## Data model

### `AiWorldInterestEvidence`

Each evidence record is:

- `world=AI_WORLD`;
- `source=AGENT_LIFE`;
- explicit provenance;
- scoped by normalized `interestKey`;
- deduped by `(interestKey, evidenceKey)`;
- `direction=support|counter`;
- bounded `strength` in `[0,1]`;
- timestamped;
- optionally linked to bounded evidence references.

Evidence is immutable after creation in P4.2.

### `AiWorldPreferenceState`

Preference state is always:

- `world=AI_WORLD`;
- `provenance=inferred`;
- `source=AGENT_LIFE`;
- score in `[-1,1]`;
- derived from persisted interest evidence;
- linked to a bounded recent evidence-ID trace;
- assigned deterministic review timing while non-neutral.

Preference state is a precursor to Soul. It is not identity and cannot directly authorize Earth actions or notifications.

## Deterministic rules

Current V0.1 constants:

- maximum single-evidence delta: `0.05`;
- preference score range: `[-1,1]`;
- time decay toward neutral: `0.005` per 24 hours;
- non-neutral preference review interval: 7 days;
- stored evidence-ID trace: latest 100 evidence IDs.

The reducer recomputes a preference from the complete persisted evidence set in deterministic chronological/key order rather than incrementing an opaque previous score. Therefore evidence arrival order and restart do not change the resulting score.

A duplicate `(interestKey, evidenceKey)` is a no-op and cannot reinforce twice.

## Review behavior

`reviewDueAiWorldPreferences()` is deterministic Runtime work:

- no Brain call;
- no model cost;
- no new evidence;
- recomputes time decay from canonical evidence;
- moves non-neutral preferences to the next review window;
- stops scheduling review once the score decays to neutral.

## World boundary

Interest evidence and preference state are canonical AI World memory only.

They cannot directly:

- become Earth observations;
- alter Earth Life State;
- mutate Earth actions;
- enqueue proactive messages;
- operate Android;
- perform external side effects.

Any future Earth influence must still travel through the explicit Evidence → Brain/Bridge → AI World event boundary agreed for the project.

## Generic AI World validation

P4.2 records are validated by the general `assertValidAiWorldData()` path as well as the preference reducer. This prevents corrupt preference/evidence boundaries from remaining invisible to ordinary AI World reads.

The validator checks:

- world/provenance/source;
- structured fields and score bounds;
- evidence dedupe;
- evidence count/ID trace consistency;
- timestamp ordering;
- preference uniqueness per interest.

## Automated protection

`test/ai-world-preference.test.ts` covers:

- one evidence item cannot exceed the hard score delta;
- duplicate evidence cannot reinforce twice;
- evidence write order does not change the deterministic result;
- seven-day review applies deterministic decay toward neutral;
- restart persistence;
- P3 deterministic world progression preserves preference memory;
- Earth Life State and delivery queues remain isolated;
- corrupt preference world boundaries fail through the generic AI World validator.

## Deferred

P4.2 deliberately does not implement:

- Soul records;
- automatic identity/personality mutation;
- user-feedback learning;
- autonomous exploration;
- Brain-generated preference deltas;
- direct Earth evidence mutation.

The next safe step is a separately bounded Soul-change layer that consumes reviewed preference/continuity evidence and proves that one interaction cannot rewrite long-term identity.
