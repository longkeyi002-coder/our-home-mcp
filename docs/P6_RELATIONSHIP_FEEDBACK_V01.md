# P6.1 — Relationship Feedback Signals V0.1

Design references: OH-31, OH-40/OH-41, OH-47, OH-52, OH-64/OH-65/OH-67, OH-P6.

## Status

P6.1 establishes the first real product/relationship feedback capture layer for delivered proactive messages. It deliberately distinguishes explicit user feedback from ambiguous interaction signals and reuses the existing bounded P4.5 Feedback → Preference → review → Soul path rather than creating a new personality-write path.

## Accepted boundary

A feedback signal must bind to one exact proactive candidate that has already reached `delivered` state.

```text
Delivered proactive message
→ traceable Earth relationship signal
→ optional deterministic P4.5 bridge
→ bounded Preference
→ explicit review
→ bounded Soul gate
```

The feedback capture layer cannot mark an undelivered message as liked/disliked and cannot mutate delivery status, Android state, Earth observations, notification output, Preference scores or Soul scores directly.

## Signals

P6.1 records:

- `like`
- `dislike`
- `reply`
- `ignore`
- `accept_suggestion`
- `reject_suggestion`

Only semantically explicit valenced actions automatically enter the P4.5 learning substrate:

- `like` → `relationship:proactive_messages` + `positive_reaction`
- `dislike` → `relationship:proactive_messages` + `negative_reaction`
- `accept_suggestion` → `relationship:suggestions` + `prefer_more`
- `reject_suggestion` → `relationship:suggestions` + `prefer_less`

`reply` and `ignore` remain durable Earth relationship signals but do **not** create Preference evidence in P6.1. A reply may be positive, negative, corrective or unrelated; an ignore may mean busy, unseen, muted or intentional rejection. Treating either as automatic valence would create false personality learning.

## Provenance and idempotency

- explicit user actions persist as `EARTH/user_declared/RELATIONSHIP` evidence;
- passive interaction facts remain Earth facts and are not silently relabeled as declared preference;
- every signal has a stable client `signalKey`;
- exact replay is idempotent;
- conflicting reuse of one signal key fails closed;
- the referenced proactive message and event time are validated before persistence;
- automatic learning uses fixed strategy keys and fixed P4.5 signal mappings; callers cannot supply arbitrary interest keys or learning strength for this automatic path.

## Soul boundary

P6.1 never writes Soul.

Explicit feedback first creates the ordinary P4.5 Earth feedback record and then deterministic AI World InterestEvidence. Preference still follows P4.2 score caps/decay/review. Soul still requires P4.3 evidence count, reviewed magnitude, evidence-set dedupe and the `0.02` maximum accepted delta.

One like/dislike/accept/reject therefore cannot directly rewrite long-term identity.

## Zero-model-cost behavior

Feedback capture and the deterministic P4.5 translation require no model call. P6.1 adds no scheduler, Brain invocation, notification or external side effect.

## Automated evidence

`test/relationship-feedback.test.ts` protects:

- feedback cannot target a missing or undelivered proactive message;
- event timestamps cannot predate delivery;
- stable signal replay is idempotent and key collisions fail closed;
- like/dislike and accept/reject use fixed P4.5 mappings;
- reply/ignore persist without Preference/Soul evidence;
- capture does not rewrite the delivered proactive candidate or Earth/Android/external state;
- persisted feedback survives restart/dedupe semantics.

Validated code/test baseline: `5d5ab419bdcce7082d1ff30a8cf52294081ee7a8`.

- Runtime CI `33971095475`: success (`npm run check`).
- Android CI `33971095486`: success (`test + lint + assembleDebug`).

## Not completed by P6.1

P6 remains `PARTIAL`. Later P6 work must still address:

- bounded interpretation/review of reply text without hidden reasoning or direct Soul writes;
- user-visible correction/review of learned strategy preferences;
- deletion/revocation semantics where required by OH-41;
- final P6 Phase Review.

Absence of interaction must not be automatically interpreted as dislike.
