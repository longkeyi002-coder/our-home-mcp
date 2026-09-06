# OH-P5 Acceptance — Autonomous Exploration V0.1

Design references: OH-20/21/22/23, OH-30/31/32, OH-40, OH-47, OH-50, OH-52, OH-60, OH-64/65/67, OH-P5.

Final review issue: #56.

## Decision

**PASS for the defined OH-P5 V0.1 boundary.**

P5 proves that AI World can spend bounded free time on public-Web exploration, persist what it encountered, revisit it later through bounded reflection, and produce a durable internal `maybe_share` intent without turning exploration into permissionless Earth-side action.

P5 completion does **not** mean the product is complete, that real-device P1/P1.5/P2 acceptance is complete, or that `maybe_share` is allowed to send a notification.

## Accepted autonomous chain

```text
AI World free time
→ deterministic topic selection
→ bounded public-Web search gateway
→ traceable Experience + Collection
→ 12h Continuity review maturity
→ bounded P4 reflection
→ internal maybe_share intent
```

The final step remains inside AI World. There is no automatic `maybe_share → proactiveQueue` transition in P5.

## P5.1 — Exploration capability boundary

Accepted protections:

- exploration is disabled by default;
- no eligible topic or non-free-time phase means zero provider calls;
- current deterministic AI World phase is derived at `asOf`, so stale persisted `free_time` cannot authorize later exploration;
- topic selection is deterministic and bound to existing AI World Thought Thread/open-question or question/interest/hobby/idea item;
- at most one provider call per cycle;
- six-hour success cooldown;
- one-hour failure backoff;
- at most two attempts per UTC day;
- persisted processing/budget state survives restart;
- strict result schema allows only bounded public HTTP(S) source URL/title/summary records;
- no authenticated session or external-action capability exists in the adapter input.

Primary tests: `test/ai-world-exploration.test.ts`.

## P5.2 — Read-only Web provider + traceable memory

Accepted protections:

- `PublicWebSearchHttpAdapter` accepts only HTTP(S) search-gateway endpoints without embedded credentials or fragments;
- network request method is GET only;
- request carries only `Accept: application/json`; no Cookie/Auth/session headers are created;
- redirects are rejected;
- timeout and response-byte limits are enforced;
- response is strict JSON with at most five bounded source records;
- Runtime does not follow arbitrary result URLs itself;
- accepted results are revalidated before persistence;
- exploration Experience is `AI_WORLD/model_generated/AGENT_LIFE` with exact topic/public-Web evidence refs;
- Collection items are deterministic by `(topicKey, URL)` and idempotent across retry/restart;
- Experience identity is deterministic by topic + canonical source URL set;
- topic is rechecked before persistence so a changed/archived source cannot receive stale results;
- persistence happens before the exploration attempt is marked successful, avoiding success-without-memory holes;
- deterministic IDs reconcile retry if the process dies after memory commit.

Primary implementation: `src/public-web-search.ts`, `src/ai-world-exploration-memory.ts`.

## P5.3 — Life Loop integration + reflection handoff

Accepted protections:

- exploration runs only inside the existing single-owner Runtime Life Loop;
- no second timer, cron, mutating worker, or overlapping loop is introduced;
- deployment remains zero-cost unless `OUR_HOME_EXPLORATION_ENABLED=true`;
- enabling exploration without a search URL fails closed during startup configuration;
- provider/persistence failures are isolated from Earth heartbeat/Wake/Care/Delivery;
- a successful exploration Experience receives deterministic `nextReviewAt = occurredAt + 12h`;
- the 12-hour timestamp is only Continuity maturity, not an immediate model invocation schedule;
- existing P4.4 reflection remains separately enabled, budgeted, provider-neutral, and free to ignore the source.

Primary tests: P5 worker/exploration integration tests.

## P5.4 — Internal maybe_share intent

Accepted protections:

- `maybe_share` is a persisted AI World semantic communication intent, not an Earth message;
- fixed boundary: `world=AI_WORLD`, `provenance=inferred`, `source=AGENT_LIFE`;
- caller supplies only exact basis type/id; title/summary/evidence refs are derived from the persisted basis;
- valid bases are a traceable exploration Experience, active exploration Collection, or model-generated reviewed reflection Thought Thread;
- missing/archived/untraceable bases fail closed;
- same `(basisType,basisId)` is idempotent across retry/restart;
- at most five pending intents exist;
- capacity overflow rejects creation rather than auto-sending or silently evicting pending intents;
- lifecycle is `pending | dismissed | consumed` and terminal state cannot be changed to another terminal state;
- strict creation schema rejects `send`, `notify`, `recipient`, `channel`, `action`, `reasoning`, `chainOfThought`, and arbitrary extras;
- intent creation/resolution cannot mutate Earth observations/Life State, `proactiveQueue`, Android state, Preference, Soul, or external systems.

Primary tests: `test/ai-world-share-intent.test.ts`.
Implementation note: `docs/P5_MAYBE_SHARE_V01.md`.

## P5.5 — Autonomous reflection → maybe_share handoff

Accepted protections:

- when bounded P4 reflection returns `recorded` or crash-recovery `reconciled`, Worker attempts exactly one P5.4 share-intent creation for the exact reflected Thought Thread;
- P5.4 basis validation/dedupe remains authoritative;
- reflection `ignore` or provider/contract failure creates no share intent;
- no new model call is introduced by the handoff;
- full pending-intent capacity or share-basis failure is caught and isolated;
- handoff failure cannot block Earth heartbeat or existing Care delivery;
- the handoff does not write `proactiveQueue` or trigger FCM/webhook delivery.

Primary test: `test/ai-world-share-handoff-worker.test.ts`.

## World / truth boundary decision

Public-Web source summaries are records of what AI World exploration read. They are not Earth Life observations and cannot be used as direct evidence about the user's real-world state.

The P5 path therefore keeps:

```text
public Web material
→ AI World Experience / Collection / reflection / maybe_share
```

separate from:

```text
EARTH observations
→ Life State
→ Wake / Care
```

Crossing from a future `maybe_share` into an Earth proactive message remains a separate Bridge/Care capability and is intentionally outside P5.

## Resource and failure review

P5 remains bounded by:

- default-off exploration;
- free-time eligibility;
- deterministic topic selection;
- one exploration provider call per eligible cycle;
- six-hour success cooldown;
- one-hour failure backoff;
- two provider attempts per UTC day;
- five-source result maximum;
- bounded response bytes;
- 12-hour reflection maturity;
- existing P4 reflection cooldown/backoff/daily limits;
- five pending `maybe_share` maximum;
- no second scheduler.

Network, provider, persistence, reflection, or share-intent failures remain isolated from the Earth heartbeat/Wake/Care/Delivery chain.

## Final automated evidence

Final P5 code baseline:

`64f7d70fe9e066cd670a9098611f624e9dca3500`

- Runtime CI run `33970480832`: **success** (`npm run check`).
- Android CI run `33970480820`: **success** (`test + lint + assembleDebug`).

Earlier P5.4 implementation/test baseline `4057160f820a00b9ec707c0d4f00be679aadf4ec` also passed Runtime CI `33970105791` and Android CI `33970105790`.

## Explicitly outside P5 acceptance

P5 PASS does not claim:

- automatic notification from `maybe_share`;
- FCM delivery of exploration findings;
- logged-in browsing;
- arbitrary result-URL fetching by Runtime;
- Xiaohongshu or other mobile-App automation;
- publishing, purchasing, account actions, or Skill installation;
- automatic like/reply/ignore/accept-reject feedback capture;
- completion of P1/P1.5/P2 real-device acceptance;
- completion of stacked PR merge/release work.

Those remain separate later phases or existing manual acceptance gates.
