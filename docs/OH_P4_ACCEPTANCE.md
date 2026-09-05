# OH-P4 — Continuity + Soul V0.1 Acceptance

Design references: OH-02, OH-03, OH-10, OH-11, OH-13, OH-20, OH-22, OH-23, OH-30, OH-31, OH-32, OH-40, OH-41, OH-60, OH-64, OH-65, OH-67, OH-P4.

## Scope

P4 proves that the AI can accumulate public reusable continuity, form bounded temporary preferences, slowly update traceable Soul tendencies, periodically revisit its own due records through a bounded cognition gate, and accept explicit user feedback without allowing one interaction or one model output to overwrite long-term identity.

P4 does **not** include autonomous web exploration (P5), automatic capture of product feedback signals such as likes/replies/ignore/accept-reject (P6), remote controlled actions (P7), or general user-facing permission/revocation UI outside the already-defined Android phases.

## Implemented stages

### P4.1 — Continuity substrate

- persistent AI World Experience records;
- Notes / Journal;
- structured Thought Threads containing reusable title/summary/conclusion/open question only;
- optional evidence references;
- deterministic `nextReviewAt` maturity;
- restart persistence and preservation across P3 world progression;
- no hidden chain-of-thought persistence;
- Earth and notification isolation.

### P4.2 — Interest evidence + bounded Preference

- explicit InterestEvidence records;
- deterministic one-state-per-interest reducer;
- `(interestKey, evidenceKey)` dedupe;
- single-evidence effect capped at `0.05`;
- score range `[-1, 1]`;
- deterministic `0.005` per 24-hour decay toward neutral;
- seven-day review cadence for non-neutral preferences;
- evidence trace and restart persistence;
- no model call required.

### P4.3 — Slow traceable Soul

- one Soul tendency per interest key;
- append-only Soul change audit;
- at least 3 evidence records required;
- Preference must be explicitly reviewed after its latest evidence;
- reviewed magnitude must be at least `0.08`;
- one canonical evidence set can affect Soul only once;
- hard maximum Soul delta `0.02` per accepted evidence set;
- deterministic `0.0002` per 24-hour decay toward neutral;
- 30-day Soul review cadence;
- Brain/callers cannot set Soul score or delta directly.

### P4.4 — Bounded review / reflection cognition

- deterministic due-source selection from Continuity;
- at most one reflection model call per Runtime cycle;
- strict `ignore | record_reflection` contract;
- exact source binding owned by Runtime;
- bounded public reflection fields only;
- read-only Soul context;
- successful reflection creates a model-generated AI World Thought Thread with exact evidence basis;
- successful decision cooldown: 6 hours;
- provider failure backoff: 1 hour;
- provider attempts capped at 3 per UTC day;
- opt-in only via `OUR_HOME_REFLECTION_ENABLED=true`;
- failure cannot block Earth Care/Delivery;
- no direct message, Earth, Android or Soul mutation action exists in the reflection contract.

### P4.5 — User feedback Bridge

Canonical path:

```text
EARTH/user_declared feedback
→ deterministic Bridge
→ AI_WORLD InterestEvidence
→ bounded Preference
→ explicit review
→ bounded Soul gate
```

- feedback persists separately as `EARTH/user_declared/RELATIONSHIP`;
- stable feedback-key idempotency and collision rejection;
- deterministic feedback-signal weights;
- derived AI World evidence keeps an exact reference to the Earth feedback record;
- no caller-controlled evidence strength, Preference score, Soul score or Soul delta;
- no model call required;
- one feedback cannot directly modify Soul.

## Final Runtime identity maintenance

The final phase review found and fixed one important integration gap: P4.2/P4.3 review functions existed and were tested, but were not yet wired into the persistent Life Loop.

The Runtime worker now performs zero-model-cost identity maintenance each cycle:

```text
advance deterministic AI World
→ review due Preferences
→ attempt eligible reviewed Preference bases through the P4.3 Soul gate
→ review / decay due Soul tendencies
→ continue ordinary Earth Wake / Care / Delivery
```

Properties:

- the worker never supplies arbitrary Soul deltas;
- existing P4.2/P4.3 eligibility and dedupe rules remain authoritative;
- if the Runtime was offline, absolute timestamps allow deterministic catch-up on the next cycle;
- identity-maintenance failure is isolated and cannot stop Earth heartbeat/Care/Delivery;
- no additional model call is introduced by Preference/Soul maintenance.

`test/ai-world-identity-worker.test.ts` proves the worker can carry reviewed feedback-derived Preference into one bounded Soul change and later catch up deterministic Soul decay after a long gap.

## Phase Design Review

### 1. Product alignment

- [x] Implemented behavior matches the referenced design sections.
- [x] No design-external feature was added silently.
- [x] The user-facing behavior still matches the intended companion relationship.
- [x] AI autonomy did not reduce user control.

Notes: P4 adds continuity and gradual identity, not unrestricted autonomy. Reflection is opt-in and user feedback is bounded evidence, not a personality overwrite command.

### 2. World / truth alignment

- [x] Earth / AI World / Fiction remain separated.
- [x] Observed / user-declared / inferred / simulated data remain distinguishable.
- [x] Inference is not promoted to fact without evidence.
- [x] AI World facts cannot answer Earth factual questions.

Notes: user feedback remains an Earth record; the Bridge creates a separate AI World inferred InterestEvidence with an explicit back-reference. Feedback is never silently relabeled as an AI World fact.

### 3. Technical alignment

- [x] Runtime Core remains provider-neutral.
- [x] Telemetry, remote-control, and delivery responsibilities remain separated.
- [x] Retry / dedupe / ordering / idempotency are addressed where relevant.
- [x] Failure of one provider/tool does not stop unrelated Runtime life.

Notes: Reflection uses a provider-neutral adapter and strict action contract. Feedback and identity maintenance are deterministic Runtime paths. P4 adds no remote-control dependency.

### 4. User control / privacy / safety

- [x] Required permissions are minimal for the P4 scope.
- [x] Sensitive collection is opt-in / on-demand where required.
- [x] External side effects follow existing action boundaries.
- [x] Relevant P4 behavior can be disabled/corrected through its existing control surfaces.

Notes: reflection is disabled by default; feedback can counter/correct prior preference evidence without direct Soul replacement. Broader Android pause/delete/revoke UI remains tracked under OH-41 and is not a P4 completion claim.

### 5. Cost

- [x] Deterministic work stays in Runtime rather than unnecessary model calls.
- [x] New recurring model calls have a clear budget/frequency policy.
- [x] External generation cost is bounded by persisted Runtime gate state.

Notes: P4.1/P4.2/P4.3/P4.5 are zero-model-cost. P4.4 calls a model only for due Continuity, at most one per cycle, with success cooldown, failure backoff and a maximum three provider attempts per UTC day. Reflection is disabled by default.

### 6. Tests from design

- [x] `docs/DESIGN_TEST_MATRIX.md` is updated for the implemented P4 layers.
- [x] Key P4 invariants have automated tests.
- [x] P4 has no new real-device-only acceptance dependency.
- [x] Regression coverage exists for the final worker-integration gap.

Primary P4 tests:

- `test/ai-world-continuity.test.ts`
- `test/ai-world-continuity-review.test.ts`
- `test/ai-world-preference.test.ts`
- `test/ai-world-soul.test.ts`
- `test/ai-world-soul-validation.test.ts`
- `test/ai-world-reflection.test.ts`
- `test/ai-world-reflection-worker.test.ts`
- `test/hermes-reflection.test.ts`
- `test/user-feedback.test.ts`
- `test/user-feedback-soul-chain.test.ts`
- `test/ai-world-identity-worker.test.ts`

### 7. Documentation

- [x] `OUR_HOME_DESIGN.md` still matches actual intended behavior.
- [x] Roadmap/test documentation is being aligned with this acceptance result.
- [x] New core capability names remain provider-neutral; Hermes remains adapter-specific only.

## Hard-question results

1. Can one interaction or one feedback directly rewrite Soul? **No.**
2. Can Brain directly set Preference/Soul numeric values? **No.**
3. Can AI World/Fiction contaminate Earth facts? **No through the protected world-boundary consumers.**
4. Can Earth user feedback be silently relabeled as AI World fact? **No.**
5. Can reflection become an unbounded model cron? **No.**
6. Can reflection directly message, operate Android, mutate Earth or Soul? **No.**
7. Are accepted long-term identity changes traceable to evidence/feedback? **Yes.**
8. Do provider failures stop unrelated Runtime life? **No.**
9. Is hidden chain-of-thought persisted by P4? **No.**
10. Are P5 autonomous exploration and full P6 product-signal capture outside P4? **Yes.**

## Validation evidence

- P4.4 latest documentation/matrix baseline `580cb032195edf507aa1434b4d1ee8e06f26eb03`: Runtime CI `33964409672` success.
- P4.5 implementation/test baseline `095f8f492c09ffb763c14bf66564cec88212f382`: Runtime CI `33964680626` success.
- P4.5 documentation baseline `03dffd94f83ff06ec5936903d32f5a03031e477d`: Runtime CI `33964739948` success.
- Final identity-maintenance worker baseline `77ba55d15150c5c3da86d918a858324d084639ea`: Runtime CI `33964882082` success; Android CI `33964882135` success.

A final Runtime CI run on the acceptance/roadmap/test-matrix documentation head is required before the Phase issue is closed.

## Review result

- [x] PASS — P4 implementation satisfies the defined Continuity + Soul V0.1 phase boundary, subject only to the final documentation-head CI check stated above.
- [ ] FAIL — return to implementation/design update.

## Open follow-ups outside P4

- OH-41 broader user-visible revoke/pause/delete controls remain incomplete at the product level.
- OH-P1/P1.5/P2 still retain their separately documented real-device acceptance obligations.
- P5 will add bounded autonomous exploration.
- P6 will automatically produce relationship/product feedback signals such as like/reply/ignore/accept/reject and adapt strategy through the P4.5 substrate.
- P7 remote read/controlled actions remain separate.

P4 completion must not be interpreted as completion of the entire Our Home V0.1 product.