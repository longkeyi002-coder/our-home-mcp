# P5.4 — Bounded `maybe_share` Intent V0.1

Design references: OH-22, OH-30/31/32, OH-40, OH-47, OH-50, OH-52, OH-64/65/67, OH-P5.

## Purpose

P5.4 adds a durable AI World communication intent that means only:

> this explored/reflected material may be worth telling the user later.

It is deliberately **not** a notification, delivery candidate, FCM payload, Earth observation, or permission to contact the user.

The architectural boundary is:

```text
AI World exploration/reflection basis
→ maybe_share intent
→ [future Bridge/Care policy]
→ optional Earth proactive message
```

P5.4 implements only the first arrow.

## Canonical intent shape

A stored intent contains:

- `kind: maybe_share`;
- `world: AI_WORLD`;
- `provenance: inferred`;
- `source: AGENT_LIFE`;
- exact basis type/id/key;
- bounded title/summary derived from the already-persisted basis;
- bounded evidence references;
- lifecycle `pending | dismissed | consumed`;
- created/updated/resolved timestamps.

The caller does not supply message text, recipient, channel, urgency, priority, due time, Soul score, or hidden reasoning.

## Allowed bases

A share intent can be created only from one of these traceable AI World records:

1. a persisted P5 public-Web exploration Experience;
2. an active P5 exploration Collection item;
3. a model-generated P4 reflection Thought Thread carrying an `ai-world-review:` basis reference.

Missing, archived, ordinary unreviewed, or otherwise untraceable records fail closed.

## Dedupe and retention

- canonical basis key is `(basisType, basisId)`;
- the same basis is idempotent across retry and restart;
- at most five pending intents are retained;
- reaching five pending intents rejects creation of another one;
- Runtime does not auto-send, auto-consume, or silently evict pending intents;
- after an explicit dismiss/consume action frees a slot, another pending intent may be created;
- terminal status cannot be changed to another terminal status.

## Side-effect boundary

Creating/resolving a P5.4 intent cannot directly mutate:

- Earth observations or Life State;
- `proactiveQueue`;
- FCM/webhook delivery;
- Android registration/visual requests;
- Preference/Soul state;
- external accounts, sessions, purchases, publishing, or device actions.

The strict creation schema rejects extra fields such as `send`, `notify`, `recipient`, `channel`, `action`, `reasoning`, and `chainOfThought`.

## Tests

`test/ai-world-share-intent.test.ts` covers:

- traceable exploration basis → one bounded pending intent;
- same-basis retry/restart idempotency;
- forbidden send/notify/recipient/channel/action/hidden-reasoning fields;
- missing/archived/untraceable basis rejection;
- five-pending hard limit with no auto-send/auto-eviction;
- explicit terminal lifecycle and slot release;
- Earth/notification/Android/Soul isolation.

Validated implementation/test baseline before this documentation commit: `4057160f820a00b9ec707c0d4f00be679aadf4ec`.
Runtime CI run `33970105791`: success.
Android CI run `33970105790`: success.

## Explicitly not P5.4

- deciding whether an intent should actually cross into Earth Care;
- creating a proactive message from an intent;
- FCM delivery;
- user feedback capture;
- logged-in browsing;
- arbitrary external actions.

Those remain separate later stages so "AI wants to share" and "user should be contacted now" cannot collapse into one permissionless action.
