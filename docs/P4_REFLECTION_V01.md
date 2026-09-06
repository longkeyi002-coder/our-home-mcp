# P4.4 — AI World Review / Reflection Cognition Gate V0.1

Design references: OH-03, OH-20, OH-22, OH-23, OH-30/31/32, OH-64, OH-65, OH-67, OH-P4.

## Purpose

P4.1 made reusable Continuity persistent. P4.2 made temporary Preference deterministic and bounded. P4.3 introduced a much slower Soul tendency layer.

P4.4 adds the first bounded model-powered cognition path **inside AI World**: when a Continuity record reaches its explicit `nextReviewAt`, Runtime may ask a Brain provider whether that exact record is worth turning into one reusable public reflection.

This is not a general background LLM loop. It is a sparse, deterministic gate around an occasional model call.

## Flow

```text
AI World Continuity record
→ nextReviewAt becomes due
→ deterministic Runtime gate
→ exact source binding
→ bounded AI World + read-only Soul input
→ Reflection Brain
→ ignore | record_reflection
→ Runtime-owned source reschedule
→ optional public Thought Thread
```

The source record is selected by Runtime. Brain cannot choose another record.

## Brain input boundary

Reflection receives only:

- the exact due AI World Experience / Note / Thought Thread;
- current AI World state;
- at most 10 read-only Soul tendencies, sorted deterministically by absolute magnitude.

It does **not** receive Earth Life context from this path. No phone state, Earth observations, proactive queue, Android state, or user-device telemetry is placed in the reflection input.

## Brain output boundary

The only legal actions are:

```text
ignore
record_reflection
```

`record_reflection` contains only bounded reusable public fields:

- `title`;
- `summary`;
- optional `conclusion`;
- optional `openQuestion`.

The schema is strict. Extra fields such as hidden `reasoning`, `chainOfThought`, `soulDelta`, arbitrary target ids, notifications, or tool actions are rejected fail-closed.

A recorded reflection is persisted as an AI World Thought Thread with `provenance=model_generated` and an exact evidence reference:

```text
ai-world-review:<recordType>:<recordId>:<source-nextReviewAt>
```

That exact review-basis reference also prevents duplicate content after an interrupted lifecycle.

## Deterministic cost / frequency policy

V0.1 constants are code-visible Runtime policy:

- at most one due source selected per Runtime cycle;
- six-hour minimum interval between successful/valid reflection decisions;
- one-hour retry backoff after provider/contract failure;
- maximum three provider attempts per UTC day, including failures;
- 20-minute persisted processing lease;
- successful `record_reflection` reschedules the source by 14 days;
- successful `ignore` reschedules the source by 30 days.

Provider failures do not mutate the due source. A failure cannot cause per-minute model retries.

## Runtime control state

Reflection cooldown/budget/lease data is persisted as Runtime control-plane state, separate from canonical AI World semantic memory.

It tracks:

- UTC budget day;
- attempts today;
- last successful completion;
- retry-after timestamp;
- current bounded processing lease.

Restart therefore preserves the model-cost guard.

## Opt-in deployment

Reflection is disabled by default.

Enable explicitly with:

```text
OUR_HOME_REFLECTION_ENABLED=true
```

Provider selection:

1. if Hermes API URL/key are configured, Runtime uses the provider-neutral Hermes reflection adapter;
2. otherwise an optional dedicated reflection webhook may be configured with:
   - `OUR_HOME_REFLECTION_WEBHOOK_URL`
   - `OUR_HOME_REFLECTION_WEBHOOK_TOKEN`

The ordinary Earth Wake decision webhook is not silently reused as a reflection endpoint.

## Hermes contract

The Hermes adapter uses the same configured conversation/model identity but sends a separate bounded reflection activation. The activation instructs Hermes to use only supplied AI World data and to return only the strict reflection JSON contract.

Runtime still validates the returned JSON independently. A Hermes response cannot create a proactive message, directly mutate Soul, select a new target, or cause an Android action through this reflection result.

## Failure and crash behavior

- provider HTTP/network/timeout/invalid JSON or invalid contract → source remains due, retry is backed off;
- an in-flight processing lease prevents overlapping duplicate work;
- if a reflection Thought Thread for the exact review basis already exists after an interrupted lifecycle, Runtime reconciles the source review without another model call;
- reflection failure is isolated from Earth heartbeat, Wake/Care and notification delivery.

## Explicit non-goals

P4.4 does not add:

- user-feedback learning;
- autonomous web exploration;
- direct Soul editing;
- free-form personality blobs;
- Earth observation mutation;
- proactive messaging from reflection;
- Android actions;
- hidden chain-of-thought persistence;
- a high-frequency LLM life loop.

## Automated protection

- `test/ai-world-reflection.test.ts`
  - zero calls without due records;
  - exact source binding;
  - public structured reflection persistence;
  - `ignore` lifecycle;
  - hidden/extra output rejection;
  - failure backoff and daily budget;
  - six-hour success cooldown;
  - restart persistence.
- `test/ai-world-reflection-worker.test.ts`
  - no reflection when no engine is supplied;
  - one explicit Worker reflection call;
  - reflection failure cannot block the Earth Life worker cycle.
- `test/hermes-reflection.test.ts`
  - bounded Hermes request shape and stable provider identity;
  - no Earth Life context in reflection input;
  - messaging / hidden reasoning / Soul mutation output attempts are rejected.

## P4 status after this step

P4 now has:

```text
Continuity
→ bounded temporary Preference
→ slow traceable Soul
→ sparse bounded reflection using Soul as read-only context
```

This still does not implement user-feedback learning or autonomous exploration. Those remain later bounded phases.