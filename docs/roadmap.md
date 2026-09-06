# Our Home — Execution Roadmap

> **Canonical design:** `docs/OUR_HOME_DESIGN.md`
>
> This file is an execution summary only. If it conflicts with the Design Constitution, `OUR_HOME_DESIGN.md` wins.

## OH-P0 — Clean Foundation

Goal: stop feature drift and make development traceable.

Required:

- provider-neutral `BrainAdapter`;
- Earth / AI World / provenance rules;
- README exposes the three core principles;
- Issue / PR templates require Design Reference;
- design-derived test matrix;
- Phase Design Review template;
- Node + Android CI;
- no hardcoded production secrets;
- `main` and old experiments remain reference-only.

Exit gate: run `docs/PHASE_REVIEW_TEMPLATE.md` against `OH-P0`.

---

## OH-P1 — Earth Life real-device chain

```text
Android sensing
→ local queue
→ HTTPS ingest
→ persisted observation
→ Life State
```

Real-device acceptance must cover:

- battery;
- charging;
- connectivity;
- foreground package / bounded usage summary;
- authentication;
- retry / dedupe;
- diagnostics.

No tap-to-upload dependency for normal telemetry.

---

## OH-P1.5 — Presence + Visual Observation

```text
Android realtime presence
→ Context Understanding
→ Curiosity
→ Sensitive Guard
→ optional Visual Observation
→ structured context
```

Required:

- foreground App transition events;
- screen on/off + lock/unlock;
- dwell sessions;
- local debounce/dedupe/offline queue;
- UsageEvents reconciliation fallback;
- Accessibility service with `canRetrieveWindowContent=false`;
- per-App visual policy with user-visible controls for `NEVER / ASK_ONLY / AUTO`;
- unknown App fail-closed default;
- protected banking/payment/password/authentication defaults;
- protected Apps cannot receive persistent `AUTO` visual access;
- temporary one-time visual grants that expire automatically and bind only to a verified live App session;
- Android 11+ optional screenshot capability;
- raw screenshot minimal lifetime;
- structured visual summaries with provenance;
- permission onboarding and OEM repair guidance;
- Curiosity cooldown/budget instead of fixed screenshot cron;
- real-device acceptance for long-dwell observation and sensitive-app blocking.

Detailed plan: `docs/OH_PRESENCE_VISUAL_PLAN.md`.

---

## OH-P2 — Wake + proactive-message minimum loop

```text
Earth change
→ Life State
→ Wake Event
→ Mock/Test Brain
→ Decision
→ FCM
→ Android notification
```

Start with a Mock Brain so phone/runtime/FCM can be proven independently of Hermes/provider availability.

Required:

- wake cooldown/dedupe;
- retryable provider failure;
- retryable notification failure;
- event trace;
- quiet/ignore policy foundations;
- notification payload can return the user to the corresponding Our Home Chat/message destination rather than only opening the Companion diagnostics surface.

---

## P3 hard gate — world + provenance schema

**Status: COMPLETE. GitHub issue #26 is closed.**

Before OH-P3 starts, persisted long-lived factual records must mechanically represent the world boundary and provenance required by the Design Constitution:

- `world`: `EARTH | AI_WORLD | FICTION`;
- provenance aligned with the canonical design (`observed`, `user_declared`, `inferred`, `simulated`, `authored`, `model_generated`, or the final canonical names);
- deterministic migration for legacy schema data;
- validation for illegal world/provenance combinations;
- Earth-state derivation must reject AI World / Fiction evidence;
- tests must prove AI World / Fiction records cannot modify Earth facts.

This gate was completed before canonical AI World persisted state began. See `docs/WORLD_BOUNDARY_PHASE_REVIEW.md` and `docs/LONG_LIVED_RECORD_BOUNDARY_CLASSIFICATION.md`.

---

## OH-P3 — AI World V0.1

**Status: COMPLETE. Acceptance: `docs/OH_P3_ACCEPTANCE.md`.**

Minimum persistent state:

- synchronized clock;
- home / room;
- virtual location;
- AI World weather;
- work state;
- current activity;
- tasks / waiting / plans / ideas / questions;
- hobbies / interests;
- collection.

Deterministic state progression does not require a model call. AI World state/history survives restart, Runtime Life Loop progression remains provider-independent, and continuity records are available through bounded Level-0 MCP tools.

P3 deliberately stops at a stable world + structured continuity substrate. It does not generate subjective goals, personality evolution, Soul, or autonomous exploration; those begin in P4+.

Validated Runtime code baseline: `93c61eaffa87737ccdf5afc4eb0518cacc5ea1f0` (`npm run check` passed in Runtime CI run `33961506239`).

---

## OH-P4 — Continuity + Soul V0.1

**Status: COMPLETE. Acceptance: `docs/OH_P4_ACCEPTANCE.md`. Final review issue #47.**

P4 proves that AI World continuity and long-term identity can evolve gradually, traceably and resource-boundedly while the model is asleep. It does not add autonomous exploration or automatic relationship-signal capture.

### P4.1 — Traceable Continuity Substrate

**Status: COMPLETE. Issue #42. See `docs/P4_CONTINUITY_V01.md`.**

Implemented:

- structured Experience records;
- Notes / Journal;
- Thought Thread with topic/summary/conclusion/open question only;
- explicit AI World world/provenance/source/timestamps;
- optional evidence references;
- deterministic `nextReviewAt` maturity;
- Experience `lastReviewedAt` + clear/reschedule lifecycle;
- restart persistence;
- preservation across deterministic P3 world progression;
- tests proving hidden reasoning / chain-of-thought fields are not persisted;
- Earth Life State / notification queues remain isolated.

Validated Runtime code baseline: `ac3ad42659cd202059a2ba2c3c9360e6e1cd01c7` (`npm run check` passed in Runtime CI run `33962034322`).

### P4.2 — Interest Evidence + Bounded Preference State

**Status: COMPLETE. Issue #43. See `docs/P4_PREFERENCE_V01.md`.**

Implemented:

- structured `AiWorldInterestEvidence`;
- one canonical `AiWorldPreferenceState` per interest;
- `(interestKey,evidenceKey)` dedupe;
- hard per-evidence score delta cap of `0.05`;
- score bounded to `[-1,1]`;
- deterministic time decay toward neutral (`0.005` per 24 hours);
- deterministic seven-day review while non-neutral;
- bounded evidence-ID trace;
- generic AI World validation for preference/evidence boundary corruption;
- restart persistence and preservation across deterministic P3 world progression;
- tests proving evidence application order does not change the reducer result;
- Earth Life State / notification queues remain isolated.

P4.2 is a temporary inferred precursor, not Soul. No model call is required for evidence application, review or decay.

Validated Runtime code baseline: `d9f00e7d58c809e37c8e514f1006b39f18057859` (`npm run check` passed in Runtime CI run `33962795575`).

### P4.3 — Bounded Traceable Soul Tendency

**Status: COMPLETE. Issue #44. See `docs/P4_SOUL_V01.md`.**

Implemented:

- one slow `AiWorldSoulTendency` per interest key;
- append-only `AiWorldSoulChange` audit history;
- preference must contain at least 3 evidence items before Soul eligibility;
- preference must be explicitly reviewed at/after its latest evidence;
- reviewed preference magnitude must be at least `0.08`;
- one canonical evidence set may influence Soul only once;
- hard Soul delta cap of `0.02` per newly accepted evidence set;
- counter evidence follows the same review gate and bounded correction path;
- deterministic Soul decay toward neutral at `0.0002` per 24 hours;
- 30-day deterministic review schedule while non-neutral;
- backdated Soul application before preference review is rejected;
- generic AI World validation protects Soul boundaries, evidence basis, audit math and dedupe;
- restart/P3 progression persistence and Earth/notification isolation.

Brain cannot write Soul scores or deltas directly. Runtime owns eligibility, magnitude and audit creation.

Validated Runtime code/test baseline: `bed1ebebf447318d7a6309805dbbc7080c1ca0f2` (`npm run check` passed in Runtime CI run `33963600675`).

### P4.4 — Bounded Review / Reflection Cognition Gate

**Status: COMPLETE. Issue #45. See `docs/P4_REFLECTION_V01.md`.**

Implemented:

- deterministic selection of one due P4.1 Continuity source;
- exact source/due-time binding controlled by Runtime;
- provider-neutral `AiWorldReflectionAdapter`;
- strict `ignore | record_reflection` decision contract;
- reflection input contains only the due AI World source, current AI World state and at most 10 read-only Soul tendencies;
- no Earth Life context enters the reflection input;
- public reusable reflection output only: title/summary/conclusion/open question;
- strict rejection of messaging, hidden reasoning, Soul-delta and arbitrary extra fields;
- six-hour cooldown after successful reflection decisions;
- one-hour provider failure backoff;
- at most three provider attempts per UTC day;
- persisted processing lease and restart-safe budget state;
- deterministic source reschedule;
- exact review-basis evidence reference for crash/dedupe reconciliation;
- optional Hermes and dedicated webhook reflection adapters;
- Worker integration isolated from Earth Wake/Care/Delivery;
- deployment default remains disabled unless `OUR_HOME_REFLECTION_ENABLED=true`.

Reflection can read Soul as context but has no action capable of changing Soul, creating a proactive message, operating Android or mutating Earth.

Validated Runtime code/test baseline: `17a1f74c39d2cbe4a1abff288f83790c319c9349` (`npm run check` passed in Runtime CI run `33964300565`).

### P4.5 — Bounded User Feedback Bridge

**Status: COMPLETE. Issue #46. See `docs/P4_USER_FEEDBACK_V01.md`.**

Implemented:

```text
EARTH/user_declared feedback
→ deterministic Bridge
→ AI_WORLD InterestEvidence
→ bounded Preference
→ explicit review
→ bounded Soul gate
```

- feedback remains a separate `EARTH/user_declared/RELATIONSHIP` record;
- stable feedback-key idempotency and collision rejection;
- deterministic feedback signal → evidence direction/strength mapping;
- exact cross-world evidence reference back to the Earth feedback record;
- no caller-controlled evidence strength, Preference score, Soul score or Soul delta;
- no model call required;
- one feedback cannot directly change Soul;
- repeated feedback still must pass P4.2 review and P4.3 evidence/magnitude/dedupe gates.

Validated Runtime implementation/test baseline: `095f8f492c09ffb763c14bf66564cec88212f382` (`npm run check` passed in Runtime CI run `33964680626`).

### Final P4 Runtime integration

The final Phase Review found and fixed one integration gap: the deterministic P4.2/P4.3 review functions existed but were not yet driven by the persistent Life Loop.

Runtime now performs zero-model-cost identity maintenance on each cycle:

```text
review due Preferences
→ attempt eligible reviewed Preference bases through Soul gate
→ review / decay due Soul tendencies
```

This path uses the existing bounded P4.2/P4.3 rules, supports absolute-time catch-up after downtime, and is failure-isolated from Earth heartbeat/Wake/Care/Delivery.

Validated final worker baseline: `77ba55d15150c5c3da86d918a858324d084639ea`; Runtime CI `33964882082` success; Android CI `33964882135` success.

Final acceptance/roadmap/test-matrix head `fc35571e44e7509ddf22f61c105c8fb105cedb3a`: Runtime CI `33965848010` success.

P4 is complete at the defined phase boundary. Automatic like/reply/ignore/accept-reject capture remains P6, and autonomous web exploration remains P5.

---

## OH-P5 — Autonomous Exploration

**Status: COMPLETE. Acceptance: `docs/OH_P5_ACCEPTANCE.md`. Final review issue #56.**

P5 proves that AI World can spend bounded virtual free time on approved public-Web exploration, persist what it encountered, revisit it through bounded reflection, and form an internal `maybe_share` intent without silently performing Earth-side actions.

Implemented:

- deterministic topic selection from active AI World questions/interests/hobbies/ideas and Thought Thread open questions;
- current-phase free-time eligibility that cannot be bypassed by stale persisted state;
- provider-neutral exploration adapter and concrete read-only public-Web search-gateway adapter;
- GET-only network requests with no cookies/authenticated sessions, rejected redirects, bounded timeout/response bytes/results;
- no arbitrary Runtime fetch of result URLs;
- traceable `AI_WORLD/model_generated` Experience + Collection persistence with exact topic/public-Web evidence refs;
- deterministic retry/restart dedupe for exploration memory;
- 12-hour Continuity maturity before explored material can enter the existing P4 reflection gate;
- exploration inside the existing single-owner Runtime Life Loop, default disabled and failure-isolated from Earth Care/Delivery;
- internal `maybe_share` intent with strict traceable basis, same-basis dedupe, terminal lifecycle and maximum five pending intents;
- automatic reflection → internal `maybe_share` handoff for recorded/reconciled reflection only;
- resource budgets: six-hour exploration success cooldown, one-hour failure backoff, two attempts per UTC day, existing P4 reflection budget, and no second scheduler.

Accepted autonomous chain:

```text
AI World free time
→ deterministic topic
→ bounded public-Web search gateway
→ Experience / Collection
→ 12h Continuity maturity
→ bounded reflection
→ internal maybe_share
```

P5 deliberately stops before Earth delivery. There is no automatic `maybe_share → proactiveQueue/FCM` transition, no logged-in mobile-App automation, no purchases/publishing/account actions, and no arbitrary result-URL fetcher.

Final validated code baseline: `64f7d70fe9e066cd670a9098611f624e9dca3500`; Runtime CI `33970480832` success; Android CI `33970480820` success (`test + lint + assembleDebug`).

---

## OH-P6 — Relationship Feedback Loop

**Status: COMPLETE. Acceptance: `docs/OH_P6_ACCEPTANCE.md`. Final review issue #71.**

P6 turns real user/product interaction into traceable relationship evidence while preserving the slow P4 learning boundary. The completed V0.1 chain is:

```text
delivered proactive message
→ explicit relationship signal or bounded reply review
→ optional explicit user confirm/correct
→ P4.5 Feedback Bridge
→ bounded Preference
→ explicit review
→ bounded Soul gate
```

### P6.1 — Delivered-message relationship signals

- durable Earth relationship feedback is bound to one exact delivered proactive message;
- explicit `like` / `dislike` / `accept_suggestion` / `reject_suggestion` actions use fixed P4.5 mappings;
- `reply` and `ignore` remain ambiguous Earth facts and do not automatically create Preference evidence;
- stable signal replay is idempotent and collisions fail closed;
- capture has no model call, notification, Android action, external action or direct Soul write.

Implementation note: `docs/P6_RELATIONSHIP_FEEDBACK_V01.md`.

### P6.2 — Bounded reply interpretation

- only explicit reply records are eligible for review;
- user-authored reply text remains `EARTH/user_declared/RELATIONSHIP`;
- model interpretation remains separately `EARTH/inferred/RELATIONSHIP`;
- strict output is limited to `ignore | propose_feedback` with fixed proposal classes;
- inferred proposals never call P4.5 automatically;
- one due reply per Life Loop cycle, six-hour success cooldown, one-hour failure backoff, three attempts per UTC day and persisted lease bound cognition cost;
- provider failure is isolated from Earth heartbeat/Wake/Care/Delivery.

Implementation note: `docs/P6_REPLY_INTERPRETATION_V01.md`.

### P6.3 — Explicit proposal confirmation/correction/dismissal

- a P6.2 proposal cannot enter learning until the user explicitly confirms or corrects it;
- the inferred proposal stays immutable and `EARTH/inferred`;
- user review is a separate `EARTH/user_declared/RELATIONSHIP` record;
- confirm/correct uses only fixed directional mappings through the existing P4.5 Bridge;
- dismiss is terminal and produces no Preference evidence;
- crash/restart replay is idempotent and conflicting terminal review fails closed;
- no model call, notification, Android action, external action or direct Soul write is added.

Implementation note: `docs/P6_REPLY_PROPOSAL_CONFIRMATION_V01.md`.

### P6.4 — Auditable learned-evidence review/revoke/correct

- bounded review links each P4.5 user feedback record to its exact AI World evidence and active/revoked status;
- revoke persists separate `EARTH/user_declared/RELATIONSHIP` and `AI_WORLD/inferred` revocation records;
- original feedback/evidence remains in audit history;
- revoked evidence is excluded from active Preference score/evidenceCount/evidenceIds rather than cancelled with fabricated opposite evidence;
- active basis changes invalidate old Preference review;
- if no active evidence remains, temporary Preference is removed while existing Soul state remains unchanged;
- correction first revokes the exact old evidence and then enters one bounded new P4.5 correction record;
- restart/dedupe/collision and corrupt revocation targets fail closed;
- historical Soul audit may continue referencing archived revoked evidence, but revoke/correct never directly rewrites Soul.

Formal integration: PR #69 / merge commit `8c4ebcc3c04fdc61576e550d6efd577e4eb2d37b`.

### Final P6 boundary

P6 does **not** infer dislike from silence or inactivity, does not allow Brain/provider/user input to set Preference or Soul numeric values, does not add a second scheduler, and does not grant learned preference authority to perform Android or external actions.

Product UI for browsing/revoking learned evidence remains a later product-surface task under OH-41; the Runtime/domain review/revoke/correct capability itself is complete. Broader delete/pause controls and P7 remote controlled actions remain separate work.

Final P6 Phase Review acceptance: `docs/OH_P6_ACCEPTANCE.md`.

---

## OH-P7 — Remote Read + Controlled Actions

```text
Remote client
→ Relay
→ Android outbound WSS
→ Local MCP
→ response
```

Migrate useful code selectively from archived experiments.

Also establish:

- action risk levels;
- permissions;
- approval states;
- audit trail;
- active-device isolation;
- reconnect/reliability tests.

This remains separate from everyday HTTPS telemetry.

---

## OH-P8 — Creative Output & Capability Proposals

Implement bounded higher-cost capabilities such as:

- occasional image generation;
- deeper research;
- richer AI World creations;
- Skill/MCP discovery proposals;
- explicit user approval before installation/configuration.

---

## V0.1 acceptance

V0.1 requires all of the following to be demonstrably true:

1. `Android observation → Runtime → Life State → Wake → Brain → Decision → FCM → Android notification` works on a real device.
2. AI World persists and progresses while the model is asleep, and a later Wake can continue structured unfinished work.
3. Earth and AI World factual queries cannot contaminate each other.
4. Mock Brain and at least one real Brain Provider can run against the same Runtime boundary.
5. Phase Review is completed and the Design → Test Matrix has no unexplained gaps for V0.1 invariants.

Presence / Visual work may progress between OH-P1 and OH-P2, but it must preserve the same rule: deterministic sensing/policy stays cheap, Vision/Brain is only invoked when a bounded reason exists.

Remote live-read/control can progress in parallel after the life chain is stable, but it must not become the dependency that keeps Earth telemetry alive.