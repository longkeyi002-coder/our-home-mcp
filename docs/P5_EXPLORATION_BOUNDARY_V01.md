# P5.1 — Bounded Public-Web Exploration Capability Boundary

Design references: OH-01, OH-20, OH-21, OH-22, OH-23, OH-30, OH-31, OH-32, OH-50, OH-52, OH-60, OH-64, OH-65, OH-67, OH-P5.

## Purpose

P5.1 establishes the boundary for future autonomous exploration before any concrete web-search/fetch provider is connected.

The rule is:

```text
AI World free time
→ deterministic traceable topic eligibility
→ Runtime cost/lease gate
→ read-only public-web adapter
→ strict bounded structured result
```

P5.1 does **not** yet turn those results into long-term memory, collection items, notifications or external actions.

## Topic source

Runtime selects one exact topic from already persisted AI World state only:

1. active Thought Thread `openQuestion`;
2. active `question` item;
3. active `interest` item;
4. active `hobby` item;
5. active `idea` item.

The selected source id/kind becomes a stable `topicKey`. Earth observations, phone state, notification queues and Android registration data are not part of the exploration input.

This first boundary intentionally uses deterministic topic selection. Later P5 cognition may choose among bounded candidates, but it must not be allowed to invent an unrestricted Earth/web target outside the Runtime capability contract.

## Current-time guard

Exploration is permitted only during deterministic AI World `free_time`.

The gate does not blindly trust the last persisted `currentActivity`. It uses the pure P3 `advanceAiWorldData()` function at the requested absolute `asOf` time to derive the effective current phase without writing to the store.

This prevents a stale evening `free_time` snapshot from authorizing a provider call after the AI World should already be winding down or sleeping.

## Adapter contract

`AiWorldExplorationAdapter` receives only:

- exact Runtime-bound AI World topic;
- effective AI World state at `asOf`;
- immutable capability declaration:
  - `publicWebOnly: true`;
  - `authenticatedSessions: false`;
  - `externalSideEffects: false`;
  - `maxSources: 5`.

The adapter may conceptually search/fetch public HTTP(S) pages. P5.1 does not implement a concrete network adapter yet.

## Strict result

Accepted output is only one of:

```json
{"status":"no_result","sources":[]}
```

or a `completed` result with 1–5 sources containing only:

- `url` — public `http:`/`https:` URL with no embedded username/password;
- `title` — max 300 characters;
- `summary` — max 2,000 characters.

The schema is strict. Extra fields such as `action`, purchase/post/message instructions, hidden reasoning or `chainOfThought` make the result invalid.

P5.1 does not persist provider output into canonical AI World memory.

## Runtime resource policy

Deterministic constants:

- maximum one provider call per exploration cycle;
- successful-call cooldown: 6 hours;
- provider/contract failure backoff: 1 hour;
- maximum provider attempts per UTC day: 2;
- processing lease: 20 minutes;
- no topic or non-free-time state: zero calls;
- core exploration call defaults to `enabled = false`.

Operational state records attempt day/count, last attempt/success, failure backoff and processing lease. It is Runtime control-plane state, not Soul or Earth evidence.

Attempts are charged before provider invocation, so a crash cannot immediately retry without consuming the already-started attempt. A stale processing lease can expire deterministically.

## Failure behavior

Provider exceptions return `provider_failed`; invalid structured output returns `contract_failed`.

Both paths:

- clear the active processing lease;
- set a one-hour retry backoff;
- persist the attempt budget;
- do not create AI World memories;
- do not create proactive messages;
- do not mutate Earth or Android state.

## Explicitly forbidden in P5.1

The capability has no contract for:

- cookies or authenticated sessions;
- logged-in account access;
- purchase/payment;
- publish/post;
- sending external messages;
- account/settings mutation;
- Skill/MCP installation;
- Android/device control;
- logged-in mobile-App automation such as Xiaohongshu;
- direct user notification/share;
- hidden chain-of-thought persistence.

## Tests

`test/ai-world-exploration.test.ts` covers:

- default-off and no-topic zero-call behavior;
- non-free-time zero-call behavior;
- stale free-time rejection using absolute time;
- exact AI World topic binding;
- absence of Earth Life context from adapter input;
- strict capability declaration;
- no result persistence/message side effect;
- side-effect/hidden-reasoning output rejection;
- provider failure backoff;
- persisted daily attempt budget across restart;
- persisted successful-call cooldown.

Validated boundary baseline: `38cb4b3ee3b6983b2f597331d6e42e31854adc79`; Runtime CI `33966616590` success.

## Next P5 step

P5.2 may add a concrete **public read-only** search/fetch provider and a separately reviewed path for turning accepted results into traceable AI World Experience/Note/Collection records.

`maybe_share` must remain a separate intent and cannot directly become a notification merely because exploration found something interesting.