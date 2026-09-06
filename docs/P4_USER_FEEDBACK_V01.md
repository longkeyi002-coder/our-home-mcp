# P4.5 — Bounded User Feedback Bridge V0.1

Design references: OH-02, OH-03, OH-13, OH-30/31/32, OH-40/41, OH-P4. OH-P6 remains the later producer of automatic product feedback signals.

## Purpose

User feedback must affect the AI over time, but the Design Constitution explicitly forbids treating feedback as a direct personality overwrite.

P4.5 therefore adds a two-record Bridge:

```text
EARTH/user_declared feedback
→ deterministic bounded mapping
→ AI_WORLD/inferred InterestEvidence
→ P4.2 Preference
→ explicit review
→ P4.3 Soul gate
```

The Earth feedback record and the derived AI World evidence remain separate and cross-referenceable.

## Earth feedback record

`UserFeedbackRecord` stores:

- `world = EARTH`;
- `provenance = user_declared`;
- `source = RELATIONSHIP`;
- stable `feedbackKey`;
- normalized target `interestKey`;
- bounded signal enum;
- optional note;
- occurred/created timestamps;
- derived evidence id after Bridge reconciliation.

A repeated identical `feedbackKey` is idempotent. Reusing the same key for a different canonical payload fails closed instead of silently collapsing unrelated feedback.

## Deterministic signal policy

Callers cannot supply evidence strength, direction, Preference score, Soul score, or Soul delta.

| Signal | Direction | P4.2 strength | Max immediate Preference effect |
|---|---|---:|---:|
| `prefer_more` | support | 0.5 | +0.025 |
| `prefer_less` | counter | 0.5 | -0.025 |
| `positive_reaction` | support | 0.25 | +0.0125 |
| `negative_reaction` | counter | 0.25 | -0.0125 |
| `correction_support` | support | 1.0 | +0.05 |
| `correction_counter` | counter | 1.0 | -0.05 |

All effects remain inside the existing P4.2 single-evidence hard cap of `0.05`.

Corrections are intentionally stronger than passive reactions, but are still bounded evidence rather than identity writes.

## Bridge traceability

Derived InterestEvidence uses a deterministic evidence key:

```text
user-feedback:<feedback-id>
```

and an explicit cross-world evidence reference:

```text
earth-user-feedback:<feedback-id>
```

If Runtime stops after the Earth feedback was persisted but before evidence was linked, a retry creates/reconciles the same P4.2 evidence key. If evidence already exists, P4.2 dedupe returns the existing record and the feedback link is repaired without another reinforcement.

## Soul protection

P4.5 has no Soul write API.

One feedback can move temporary Preference only by the table above. To affect Soul later, the resulting canonical evidence set must still satisfy P4.3:

- at least three total evidence items;
- explicit Preference review after the latest evidence;
- reviewed magnitude at least `0.08`;
- one canonical evidence basis accepted only once;
- maximum Soul delta `0.02` per newly accepted basis.

Automated integration demonstrates that five `prefer_more` feedback records produce temporary Preference `0.125`; after seven days of P4.2 decay/review the Preference is `0.09`; only then can P4.3 accept one bounded `+0.02` Soul change.

A user statement such as “change your personality to X” cannot set a Soul value. At most, an allowed feedback signal may become one bounded evidence item.

## Isolation

Recording/applying feedback does not directly alter:

- Earth Life State;
- Earth observations/actions;
- AI World deterministic state/history;
- proactive notification queues;
- Android device registrations or visual requests;
- external tools/actions.

No model call is required for the feedback Bridge.

## P4.5 versus P6

P4.5 is the safe learning substrate only.

It does **not** automatically interpret or capture concrete product behaviors such as:

- message like/dislike;
- reply/ignore behavior;
- accept/reject suggestion;
- UI reaction events.

OH-P6 will later define which concrete product events are valid signals, how they are collected, and how behavioral strategy adapts. Those future producers must feed this bounded substrate rather than create a direct Soul shortcut.

## Automated protection

`test/user-feedback.test.ts` covers:

- Earth/user-declared persistence;
- separate AI World inferred evidence;
- exact cross-world reference;
- deterministic signal mapping;
- feedback-key idempotency and collision rejection;
- crash-window/restart reconciliation;
- one-feedback no-direct-Soul protection;
- Earth/delivery/Android isolation;
- corrupt feedback boundary rejection on feedback reads.

`test/user-feedback-soul-chain.test.ts` covers:

- repeated feedback → temporary Preference;
- no Soul change before explicit review;
- seven-day Preference decay/review;
- later Soul change only through existing P4.3 hard cap;
- end-to-end trace from Soul basis evidence back to Earth feedback ids;
- every feedback policy remains within P4.2's single-evidence cap.

## Non-goals

P4.5 does not add:

- automatic P6 reaction capture;
- direct personality editing;
- direct Soul mutation;
- model-selected learning weights;
- autonomous exploration;
- messaging or Android side effects.
