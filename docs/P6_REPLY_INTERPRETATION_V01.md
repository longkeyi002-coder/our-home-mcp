# P6.2 — Bounded Reply Interpretation Proposals V0.1

Design references: OH-03, OH-22, OH-31, OH-40/OH-41, OH-52, OH-64/OH-65/OH-67, OH-P6.

## Status

P6.2 adds bounded semantic review for the content of a user's reply to a delivered proactive message. It deliberately does **not** convert model interpretation into user-declared feedback, Preference evidence, or Soul changes.

The three evidence layers remain distinct:

```text
reply interaction happened
= EARTH / observed / RELATIONSHIP

user-authored reply text
= EARTH / user_declared / RELATIONSHIP

model interpretation proposal
= EARTH / inferred / RELATIONSHIP
```

An inferred proposal is not a user confirmation.

## Source binding

Reply content can only be recorded against an existing P6.1 relationship-feedback record whose signal is exactly `reply` and whose proactive subject is already delivered.

Each reply signal can bind to one canonical reply-content record. Replaying the same text is idempotent; attempting to replace it with different text under the same reply binding fails closed.

The reply text is bounded to 5,000 characters and carries a deterministic SHA-256 digest for basis/dedupe checks.

## Provider-neutral review contract

`RelationshipReplyReviewAdapter` receives only:

- the exact relationship reply id/signal key/time;
- bounded user-authored reply text;
- the exact delivered proactive message id/title/body/delivery time;
- the current review timestamp.

It does not receive unrelated Earth Life observations, phone state, AI World state, Soul, notification queues, or arbitrary memory context.

The strict output is only:

```text
ignore
```

or

```text
propose_feedback {
  class,
  summary
}
```

Allowed proposal classes are fixed by Runtime:

- `proactive_messages_more`
- `proactive_messages_less`
- `suggestions_more`
- `suggestions_less`
- `correction`

The output contract rejects arbitrary interest keys, evidence strength, Preference/Soul values, send/notify/action fields, and hidden reasoning/chain-of-thought fields.

## Proposal semantics

A valid proposal is persisted as:

- `world: EARTH`
- `provenance: inferred`
- `source: RELATIONSHIP`
- exact reply-content / relationship-feedback / proactive-message references;
- one fixed proposal class;
- one bounded public summary;
- deterministic basis key;
- `status: pending`.

P6.2 never calls P4.5 for these inferred proposals.

Therefore:

```text
model interpretation
≠ user-declared feedback
≠ Preference evidence
≠ Soul update
```

A later P6 step must provide explicit confirm/correct/dismiss semantics before an inferred proposal can enter the existing user-declared P4.5 bridge.

## Retry / restart / budget

P6.2 follows the same sparse cognition pattern as P4.4:

- at most one due reply review per Runtime cycle;
- six-hour cooldown after a completed review;
- one-hour provider failure backoff;
- maximum three provider attempts per UTC day;
- persisted processing lease for crash/restart safety;
- same reply/text basis cannot create duplicate proposals;
- provider/contract failure leaves the source unreviewed for bounded retry.

There is no second scheduler or high-frequency model cron.

## Worker integration

Reply review is an optional step inside the existing single-owner Runtime Life Loop.

Deployment default is disabled:

```text
OUR_HOME_RELATIONSHIP_REPLY_REVIEW_ENABLED=false
```

When explicitly enabled, a dedicated webhook endpoint is required:

```text
OUR_HOME_RELATIONSHIP_REPLY_REVIEW_WEBHOOK_URL
OUR_HOME_RELATIONSHIP_REPLY_REVIEW_WEBHOOK_TOKEN   # optional
```

If the review provider fails or persisted reply-review state is corrupt, the failure is isolated from the rest of the Life Loop. Earth heartbeat/Wake/Care/Delivery continues.

## Automated evidence

`test/relationship-reply-review.test.ts` protects:

- exact P6.1 reply-signal binding;
- `observed` interaction vs `user_declared` text provenance;
- one canonical text record per reply;
- strict adapter input/output contract;
- inferred proposal boundary;
- zero direct Preference/UserFeedback/Soul writes;
- ignore behavior;
- cooldown/backoff and restart persistence.

`test/relationship-reply-review-worker.test.ts` protects:

- no adapter means zero reply-review work;
- explicit adapter causes at most one review inside one Life Loop cycle;
- provider failure cannot block heartbeat or an existing due Care delivery.

Validated implementation/test baseline: `7cf94d2559f2fc3aa04ae15014bde64ad9eaa220`.

Runtime CI `33971893308`: success (`npm run check`).

## Explicitly not P6.2

- silently treating inferred proposal as user preference;
- interpreting passive `ignore`/absence as dislike;
- user approval/dismissal UI;
- automatic application of reply semantics to P4.5;
- final P6 Phase Review.
