# Our Home — OH-P6 Final Acceptance

Status: **PASS**

Final Phase Review: GitHub issue #71

Integrated code baseline before acceptance documentation: `8c4ebcc3c04fdc61576e550d6efd577e4eb2d37b`.

## Phase boundary

OH-P6 proves that real relationship/product feedback can influence future strategy while preserving the slower P4 learning boundary and without giving user actions, reply-model interpretation, or Runtime callers a direct Preference/Soul overwrite path.

Accepted chain:

```text
Delivered proactive message
→ explicit/observed Earth relationship signal
→ optional bounded reply interpretation proposal
→ explicit user confirm/correct/dismiss gate
→ P4.5 user-declared Feedback Bridge
→ bounded temporary Preference
→ explicit Preference review
→ bounded P4.3 Soul gate
```

P6.4 additionally makes already-learned strategy evidence auditable and explicitly revocable/correctable without deleting historical truth or directly rewriting Soul.

## P6.1 — Delivered-message relationship signals

Accepted:

- every signal binds to one exact proactive candidate that is already `delivered`;
- signals are limited to `like`, `dislike`, `reply`, `ignore`, `accept_suggestion`, `reject_suggestion`;
- stable `signalKey` replay is idempotent and conflicting reuse fails closed;
- event time cannot predate actual message delivery;
- `like` / `dislike` map only to `relationship:proactive_messages` through fixed P4.5 signals;
- `accept_suggestion` / `reject_suggestion` map only to `relationship:suggestions` through fixed P4.5 signals;
- `reply` and `ignore` remain ambiguous Earth relationship facts and do not automatically produce Preference evidence;
- absence of interaction is not interpreted as dislike;
- capture is zero-model-cost and cannot mutate message delivery, Android state, Earth observations, notification output, or external systems.

Primary evidence: `test/relationship-feedback.test.ts`, `docs/P6_RELATIONSHIP_FEEDBACK_V01.md`.

## P6.2 — Bounded reply interpretation proposals

Accepted:

- only an exact existing P6.1 `reply` signal may bind reply content;
- user-authored reply text remains `EARTH/user_declared/RELATIONSHIP`;
- the fact that a reply occurred remains separate Earth interaction evidence;
- model interpretation is separately persisted as `EARTH/inferred/RELATIONSHIP`;
- `RelationshipReplyReviewAdapter` receives only bounded exact reply/message context, not unrelated Earth Life state, AI World private state, Soul, or arbitrary memory;
- strict provider output is `ignore | propose_feedback` only;
- proposed strategy class is restricted to the fixed P6.2 enum;
- arbitrary interest keys, learning strength, Preference/Soul values, send/notify/action fields, and hidden reasoning are rejected;
- inferred proposal never directly enters P4.5;
- at most one due reply review runs per Runtime Life Loop cycle;
- six-hour success cooldown, one-hour failure backoff, maximum three attempts per UTC day, and persisted lease bound model cost;
- feature is default disabled and adds no second scheduler;
- provider failure is isolated from Earth heartbeat/Wake/Care/Delivery.

Primary evidence: `test/relationship-reply-review.test.ts`, `test/relationship-reply-review-worker.test.ts`, `docs/P6_REPLY_INTERPRETATION_V01.md`.

## P6.3 — Explicit user confirmation gate

Accepted:

- a P6.2 inferred proposal starts pending and transitions once to `confirmed`, `corrected`, or `dismissed`;
- the original inferred proposal remains immutable and auditable as `EARTH/inferred/RELATIONSHIP`;
- user review is a separate `EARTH/user_declared/RELATIONSHIP` record;
- only four fixed directional proposal classes can enter learning;
- the non-directional `correction` proposal cannot be confirmed directly into learning;
- confirm/correct enter learning only through the existing P4.5 Bridge;
- dismiss is terminal and produces no P4.5 feedback, Preference evidence, or Soul change;
- stable `reviewKey` and deterministic feedback-key reconciliation make crash/restart replay idempotent;
- caller cannot supply arbitrary learning numbers, notification fields, Android actions, or external targets;
- P6.3 adds zero model calls, schedulers, notifications, Android actions, or external actions.

Primary evidence: `test/relationship-reply-proposal-review.test.ts`, `docs/P6_REPLY_PROPOSAL_CONFIRMATION_V01.md`.

## P6.4 — Review, revoke, and correct learned strategy evidence

Accepted:

- bounded review links each exact P4.5 `UserFeedbackRecord` to its derived AI World InterestEvidence and reports active/revoked state;
- revocation first persists a separate `EARTH/user_declared/RELATIONSHIP` fact;
- deterministic Bridge creates a separate `AI_WORLD/inferred` evidence-revocation record;
- original Earth feedback and original AI World evidence remain auditable;
- original evidence is moved from the active reducer set to a revoked evidence audit archive instead of deleted or counterbalanced with fabricated opposite evidence;
- temporary Preference is recomputed only from active evidence;
- revoked evidence is excluded from Preference score, evidenceCount, and evidenceIds;
- changing the active evidence basis invalidates the previous Preference review basis;
- if no active evidence remains, temporary Preference is removed rather than creating an opposite preference;
- correction revokes the exact old evidence first and then creates one new explicit P4.5 correction using only `correction_support` / `correction_counter`;
- stable revocation keys, one-feedback-at-most-once semantics, collision rejection, and restart reconciliation prevent duplicate revocation/reinforcement;
- generic AI World validation understands the revocation archive and fails closed on forged boundary, missing/unrelated targets, duplicate identities, and orphaned archived evidence;
- existing Soul tendency and Soul change audit remain unchanged by revoke/correct itself, including when all active Preference evidence is revoked.

Primary evidence:

- `test/relationship-feedback-review.test.ts`
- `test/relationship-feedback-revocation.test.ts`
- `test/relationship-feedback-revocation-soul.test.ts`
- `test/relationship-feedback-revocation-validation.test.ts`
- PR #69 / issue #61

## Hard-question review

1. Can one like/dislike/reply/correction directly set Preference or Soul numeric values? **NO**.
2. Can passive `ignore` or silence automatically become negative preference? **NO**.
3. Can a model-interpreted reply proposal silently masquerade as user-declared feedback? **NO**.
4. Can an inferred proposal enter P4.5 without explicit user confirm/correct? **NO**.
5. Can the `correction` proposal class be guessed into a direction? **NO**.
6. Can callers choose arbitrary strategy keys, evidence strength, Preference score, Soul score, or Soul delta through P6 paths? **NO**.
7. Can learned evidence be revoked by fabricating opposite evidence? **NO**; it is removed from the active basis and retained in audit history.
8. Can revoke/correct directly rewrite or delete old Soul audit? **NO**.
9. Can restart/replay duplicate feedback, proposal review, revocation, or replacement evidence? **NO through the protected stable-key reconciliation paths**.
10. Can P6 model/provider failure block Earth heartbeat/Wake/Care/Delivery? **NO** for the bounded P6.2 provider path.
11. Does P6 introduce a second scheduler or high-frequency model life loop? **NO**.
12. Does P6 create Android/device/external-action authority from learned relationship strategy? **NO**.

## Validation evidence

P6.1 validated baseline:
- code baseline `5d5ab419bdcce7082d1ff30a8cf52294081ee7a8`;
- Runtime CI `33971095475`: success;
- Android CI `33971095486`: success.

P6.2 validated baseline:
- code baseline `7cf94d2559f2fc3aa04ae15014bde64ad9eaa220`;
- Runtime CI `33971893308`: success.

P6.3 validated baseline:
- code baseline `fd336e65b22dfe5c7af3e1958dd5688a740da1aa`;
- Runtime CI `33972516993`: success;
- later current-stack Runtime validation also remained green.

P6.4 final feature head:
- `17bd1adf3b4fa446b3c002752bc81cc7121caaf1`;
- Runtime CI #518: success;
- Android CI #702: success.

Integrated development-line baseline after P6.4 merge:
- `8c4ebcc3c04fdc61576e550d6efd577e4eb2d37b`.

## Known non-goals / remaining product work

P6 PASS does **not** claim:

- a finished user-facing UI for reviewing, revoking, or correcting learned strategy evidence;
- that silence/inactivity can be interpreted as dislike;
- arbitrary free-form reply text can directly become learning;
- learned Preference/Soul can authorize remote device or external-account actions;
- P7 remote read / controlled-action work is complete;
- P1/P1.5/P2 real-device acceptance is complete;
- production Runtime deployment or the separate production push-registration issue is automatically fixed by P6.

## Result

**OH-P6 Relationship Feedback Loop V0.1: PASS at the defined Runtime/domain boundary.**

P6 is complete only as a bounded, traceable relationship-learning substrate. Product UI and later controlled-action phases remain separate work.