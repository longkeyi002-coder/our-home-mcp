# P6.3 — Explicit Reply Proposal Confirmation Bridge V0.1

Design references: OH-03, OH-31, OH-40/OH-41, OH-52, OH-64/OH-65/OH-67, OH-P6.

## Status

P6.3 closes the safety gap between P6.2 model interpretation and the existing P4.5 learning bridge.

A P6.2 proposal is only `EARTH/inferred`. It cannot become Preference evidence until the user performs an explicit `EARTH/user_declared` review action.

```text
P6.2 inferred proposal
→ user confirm / correct / dismiss
→ separate user-declared review record
→ optional P4.5 bridge
→ bounded Preference
→ explicit review
→ bounded Soul gate
```

The original inferred proposal is not rewritten as user-declared evidence.

## Proposal lifecycle

A proposal starts:

- `pending`

and may transition once to one terminal status:

- `confirmed`
- `corrected`
- `dismissed`

Terminal metadata contains:

- `reviewedAt`
- `reviewRecordId`
- optional directional `resolvedClass`

The original `proposalClass`, `summary`, basis and `EARTH/inferred/RELATIONSHIP` provenance remain unchanged. This preserves the distinction between what the model inferred and what the user ultimately confirmed.

## Fixed directional classes

Only these classes may produce learning:

- `proactive_messages_more`
- `proactive_messages_less`
- `suggestions_more`
- `suggestions_less`

Fixed P4.5 mappings:

- `proactive_messages_more` → `relationship:proactive_messages` + `prefer_more`
- `proactive_messages_less` → `relationship:proactive_messages` + `prefer_less`
- `suggestions_more` → `relationship:suggestions` + `prefer_more`
- `suggestions_less` → `relationship:suggestions` + `prefer_less`

The P6.2 class `correction` is intentionally not directional. It cannot be confirmed directly into learning. The user must explicitly choose one of the four directional classes with `correct`, or dismiss the proposal.

For a directional proposal, `correct` must choose a different directional class; choosing the original class should use `confirm`.

## User review record

P6.3 persists a separate `RelationshipReplyProposalUserReviewRecord` with:

- `world: EARTH`
- `provenance: user_declared`
- `source: RELATIONSHIP`
- stable client `reviewKey`
- exact proposal id
- `confirm | correct | dismiss`
- optional resolved directional class
- event/creation timestamps
- optional derived P4.5 feedback id

The review input is strict. Callers cannot supply arbitrary interest keys, evidence strength, Preference/Soul scores or deltas, notification fields, Android actions or external-action targets.

## Dismiss semantics

`dismiss` is terminal and creates no P4.5 feedback, no Preference evidence and no Soul change.

A dismissed proposal cannot later be confirmed under a different review action.

## Confirm / correct semantics

`confirm` and `correct` first persist the user-declared review and terminal proposal status. Only then does Runtime reconcile through P4.5 with a deterministic feedback key derived from the review record.

P4.5 remains the sole Bridge into AI World preference evidence. P6.3 cannot choose the learning strength and cannot write Soul directly.

## Crash / restart safety

The ordering is deliberate:

```text
persist user review + terminal proposal
→ call deterministic P4.5 feedback bridge
→ record derived feedback id on user review
```

If the process dies between those steps, replaying the exact same `reviewKey` reuses the same review record and P4.5 feedback key. Existing P4.5 evidence-key dedupe prevents duplicate reinforcement.

Conflicting `reviewKey` reuse or a second terminal review for the same proposal fails closed.

## Resource and side-effect boundary

P6.3 requires:

- zero model calls;
- zero new scheduler/cron;
- zero notification/FCM work;
- zero Android/device action;
- zero external network side effect.

It is a deterministic user-action bridge only.

## Automated evidence

`test/relationship-reply-proposal-review.test.ts` protects:

- confirm → fixed P4.5 mapping;
- correction proposals cannot be confirmed directly;
- explicit corrected directional class is required for correction learning;
- original inferred proposal fields/provenance remain immutable;
- dismiss is terminal and produces no learning;
- strict input rejects arbitrary learning/external-action fields;
- exact review replay is idempotent;
- conflicting/second terminal review fails closed;
- restart replay preserves one review, one P4.5 feedback and one Preference evidence item;
- no direct Soul rewrite occurs.

Validated implementation/test baseline: `fd336e65b22dfe5c7af3e1958dd5688a740da1aa`.

Runtime CI `33972516993`: success (`npm run check`).

## Explicitly not P6.3

- product UI for proposal review;
- deletion/revocation of already-derived learned evidence;
- broad learned-strategy review screen;
- final P6 Phase Review.
