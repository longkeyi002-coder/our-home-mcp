# P6.1 — Relationship Feedback Signals V0.1

Design references: OH-31, OH-40/41, OH-47, OH-52, OH-64/65/67, OH-P6.

## Purpose

P6.1 turns explicit product interactions with an already-delivered Our Home proactive message into traceable Earth relationship-signal records. Only signals with clear positive/negative meaning are translated through the existing P4.5 Feedback Bridge.

The boundary is:

```text
delivered proactive message
→ Earth relationship signal
→ [only if explicitly valenced] P4.5 user feedback
→ AI World InterestEvidence
→ bounded Preference
→ later review
→ bounded Soul gate
```

No product interaction directly writes Soul.

## Signals

Supported V0.1 signals:

- `like`;
- `dislike`;
- `reply`;
- `ignore`;
- `accept_suggestion`;
- `reject_suggestion`.

### Explicit valenced actions

These are stored as `EARTH/user_declared/RELATIONSHIP` and deterministically mapped into P4.5:

| Product signal | Fixed strategy interest | P4.5 signal |
|---|---|---|
| `like` | `relationship:proactive_messages` | `positive_reaction` |
| `dislike` | `relationship:proactive_messages` | `negative_reaction` |
| `accept_suggestion` | `relationship:suggestions` | `prefer_more` |
| `reject_suggestion` | `relationship:suggestions` | `prefer_less` |

The caller cannot choose an arbitrary interest key, evidence strength, Preference score, Soul score or Soul delta for this automatic mapping.

### Ambiguous interaction signals

`reply` and `ignore` are stored as `EARTH/observed/RELATIONSHIP` interaction records only.

They do **not** automatically create P4.5 feedback or Preference evidence because:

- replying does not necessarily mean agreement or preference;
- lack of interaction can mean busy, asleep, notification hidden, device offline, or many other non-negative states.

P6 must not train dislike from ambiguous absence.

## Exact delivered-message binding

Every signal requires:

- a stable client `signalKey`;
- one exact `proactiveCandidateId`;
- the candidate to exist in `proactiveQueue` with `status=delivered` and a `deliveredAt` timestamp;
- signal `occurredAt >= deliveredAt`;
- signal `occurredAt <= createdAt/asOf`.

Feedback for a missing, pending or not-yet-delivered message fails closed.

## Retry / restart

- `signalKey` is unique and stable;
- replay of the same canonical payload is idempotent;
- conflicting reuse of the same key fails closed;
- P4.5 feedback uses `relationship-signal:<signalKey>` as its stable feedback key;
- crash/restart replay cannot reinforce the same Preference evidence twice;
- relationship-signal records survive JSON Store restart.

## Side-effect boundary

P6.1 capture cannot directly mutate:

- the referenced message's delivery state;
- Earth observations or Life State;
- Android registration/visual state;
- notification delivery;
- external systems;
- Soul.

Explicit valenced actions can only enter the already-bounded P4.5 → P4.2 → P4.3 learning chain.

## Tests

`test/relationship-feedback.test.ts` protects:

- delivered-message binding and timestamp ordering;
- strict input contract;
- fixed strategy-key mappings;
- like/dislike/accept/reject bounded P4.5 translation;
- reply/ignore no-Preference behavior;
- stable-key idempotency/collision rejection;
- restart preservation;
- no delivery/observation/Soul side effects.

Validated code/test baseline: `5d5ab419bdcce7082d1ff30a8cf52294081ee7a8`.
Runtime CI run `33971095475`: success.

## Explicitly not P6.1

- reply-text semantic analysis;
- inferring dislike from passive inactivity;
- Android/UI reaction controls;
- direct strategy rewriting outside P4.5/P4.2/P4.3;
- completion of the full OH-P6 phase.
