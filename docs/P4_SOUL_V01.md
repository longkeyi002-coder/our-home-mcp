# P4.3 — Bounded Traceable Soul Tendency V0.1

Design Reference: OH-03, OH-20, OH-22, OH-30, OH-31, OH-32, OH-65, OH-P4.

## Purpose

P4.3 introduces the first real Soul layer, but only as a slow, bounded and auditable tendency state.

Soul is not a free-form personality blob and is not directly writable by Brain. The path is deliberately staged:

```text
AI World experience / evidence
→ temporary PreferenceState
→ explicit deterministic preference review
→ bounded Soul tendency change
→ later review / slow decay
```

A single interaction has no direct path into Soul.

## Eligibility gate

A preference may influence Soul only when all of the following are true:

- it exists as canonical `AI_WORLD/inferred` preference state;
- it contains at least 3 evidence records;
- it has completed an explicit preference review;
- that review occurred at or after the latest evidence;
- the reviewed preference magnitude is at least `0.08`;
- the same canonical evidence set has not already been applied to Soul.

Adding new evidence invalidates the old review for Soul purposes until the preference is reviewed again.

## Bounded policy

V0.1 deterministic constants:

- Soul score range: `[-1, 1]`;
- minimum evidence count: `3`;
- minimum reviewed preference magnitude: `0.08`;
- maximum Soul delta for one newly accepted evidence set: `0.02`;
- Soul time decay: `0.0002` per 24 hours toward neutral;
- Soul review interval: 30 days;
- stored recent basis evidence trace: at most 100 IDs.

The caller cannot provide a Soul score or delta. Runtime derives the change locally by moving the current Soul tendency toward the reviewed preference by at most `0.02`.

## Evidence-set dedupe

Each preference-derived Soul change has a stable SHA-256 `basisKey` derived from:

- normalized interest key;
- the complete canonical evidence-ID set in deterministic order.

The same basis key can be accepted only once. Re-reviewing the same evidence without new evidence cannot reinforce Soul again.

New evidence produces a new basis only after it has passed preference review.

## Correction

Counter evidence follows the same slow path and the same cap. It does not overwrite an existing tendency.

Example:

- reviewed positive preference moves Soul from `0.00` to at most `+0.02`;
- later counter evidence is added;
- before review, Soul does not change;
- after the new preference review, correction can move Soul by at most `-0.02` for that new evidence set.

## Time decay

Soul decay is deterministic Runtime work and does not call Brain.

A non-neutral Soul tendency receives a review time 30 days after its last accepted change/review. When due, its score moves toward zero by `0.0002 × elapsed days`.

Decay changes are also appended to the Soul audit history. Once a tendency reaches neutral, no further review is scheduled until new reviewed preference evidence changes it again.

## Audit model

`AiWorldSoulTendency` stores the current slow tendency state.

`AiWorldSoulChange` is append-only audit evidence containing:

- before score;
- after score;
- exact delta;
- reason (`preference_evidence` or `time_decay`);
- timestamp;
- basis preference ID for reinforcement/correction;
- stable evidence-set basis key;
- bounded evidence-ID trace.

## Truth and capability boundary

Soul records are always:

- `world=AI_WORLD`;
- `provenance=inferred`;
- `source=AGENT_LIFE`.

P4.3 cannot directly:

- create or rewrite Earth facts;
- enqueue a proactive notification;
- operate Android;
- perform external actions;
- accept an arbitrary Brain-provided Soul score;
- store hidden chain-of-thought.

Any later effect on Earth still requires the normal Brain/Bridge decision boundary.

## Generic persisted-memory validation

Soul memory participates in generic `assertValidAiWorldData()` validation through an independent non-circular validator.

It rejects:

- illegal world/provenance/source;
- score ranges outside `[-1,1]`;
- Soul tendency with fewer than 3 supporting evidence records;
- unrelated/missing evidence IDs;
- duplicate tendency keys/IDs;
- inconsistent timestamps;
- inconsistent before/after/delta audit math;
- preference-derived delta above `0.02`;
- missing preference/evidence basis;
- reused preference basis key;
- a time-decay event that moves away from neutral or carries a reinforcement basis.

Preference `lastReviewedAt` lifecycle ordering is also validated so Soul eligibility cannot be fabricated by a malformed review timestamp.

## Automated protection

`test/ai-world-soul.test.ts` covers:

- one evidence item cannot alter Soul;
- three evidence items still cannot alter Soul before preference review;
- accepted reviewed evidence changes Soul by at most `0.02`;
- repeated review of the same evidence set cannot reinforce twice;
- new counter evidence requires a new preference review;
- counter evidence corrects Soul only by the bounded delta;
- Soul decay is slower than temporary preference decay;
- restart and P3 world progression preserve Soul state/history;
- Soul mutations do not alter Earth Life State or notification queues;
- backdated Soul application before preference review is rejected.

`test/ai-world-soul-validation.test.ts` covers generic corruption rejection for world-boundary and hard-delta violations.

## Deferred

P4.3 does not implement:

- user-feedback learning;
- arbitrary personality dimensions;
- Brain-selected Soul numeric deltas;
- autonomous browsing/exploration;
- direct Earth→Soul mutation;
- relationship feedback loop.

Those remain separate later steps so the slow identity layer stays debuggable and auditable.
