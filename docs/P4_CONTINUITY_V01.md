# P4.1 — Continuity Substrate V0.1

Design Reference: OH-03, OH-11, OH-22, OH-30, OH-31, OH-32, OH-64, OH-65, OH-67, OH-P4.

## Purpose

P4.1 gives the AI a traceable way to hand reusable experience and unfinished thought structure to its future self.

It deliberately does **not** implement Soul reinforcement/decay yet. The goal is to make continuity inspectable and debuggable before long-term personality starts changing.

Validated Runtime code baseline: `ac3ad42659cd202059a2ba2c3c9360e6e1cd01c7`.
Runtime CI run `33962034322`: success (`npm run check`).

## Persistent record types

### Experience

Stores a reusable summary of something experienced in AI World:

- fixed `world=AI_WORLD`;
- explicit provenance;
- `source=AGENT_LIFE`;
- summary;
- occurred/created timestamps;
- optional confidence;
- optional evidenceRefs;
- optional `lastReviewedAt` / `nextReviewAt`.

Experience content is immutable through the review lifecycle. Review can only clear/reschedule the next review and record when the review happened.

### Note / Journal

Stores explicit public-style written content:

- `note` or `journal` kind;
- title/body;
- explicit boundary/provenance/source;
- evidenceRefs;
- `nextReviewAt`;
- created/updated timestamps.

### Thought Thread

Stores reusable thought continuity only:

- title/topic;
- summary;
- optional current conclusion;
- optional open question;
- status: active/resolved/archived;
- evidenceRefs;
- `nextReviewAt`;
- created/updated timestamps.

There is intentionally no field for hidden reasoning steps, scratchpad, internal chain-of-thought, or token-level model trace. Unknown `reasoning` / `chainOfThought` input fields are not persisted by the structured API.

## Review maturity

`listDueAiWorldReviews()` is deterministic Runtime work:

- compares explicit absolute `nextReviewAt` timestamps;
- sorts due records deterministically;
- performs no store mutation;
- performs no Brain/model call;
- archived Thought Threads are excluded;
- Experience can be reviewed, cleared or rescheduled without rewriting its content/provenance;
- rescheduling cannot point into the past relative to the review action, preventing immediate retry churn.

A future P4 reflection layer may choose whether a due record actually deserves model cognition. `nextReviewAt` itself does not wake a model.

## World boundary

All P4.1 records are canonical AI World continuity. They cannot become Earth evidence merely by being stored.

Earth influence remains:

`Earth Evidence → Brain/Bridge → explicit AI World event/record → AI World`

P4.1 does not add a direct Earth-to-AI-World mutation path.

Continuity writes do not alter:

- Earth Life State;
- Earth observations;
- proactive-message delivery queues;
- Android/device state.

## Persistence / failure behavior

- P3 AI World phase progression preserves P4 continuity collections.
- Records survive JSON Store restart.
- Missing continuity on pre-P4 AI World data is treated as empty and initialized only on a continuity write/new world creation.
- Invalid continuity world/source/provenance and invalid review timestamps fail closed.

## Automated coverage

- `test/ai-world-continuity.test.ts`
- `test/ai-world-continuity-review.test.ts`

Coverage includes record types, no-chain-of-thought persistence, deterministic read-only review maturity, restart, P3 state progression preservation, Earth isolation, immutable boundary/provenance and fail-closed review scheduling.

## Deferred to later P4 steps

P4.1 does not implement:

- interest evidence accumulation;
- preference strength;
- reinforcement/decay;
- Soul changes;
- user feedback learning;
- autonomous exploration;
- automatic subjective experience generation.

The next bounded P4 step should add **interest evidence and bounded preference state** on top of this traceable substrate, before any richer autonomous behavior is allowed.
