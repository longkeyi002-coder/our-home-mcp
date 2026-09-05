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

Implement:

- Experience records;
- Notes / Journal;
- Thought Thread;
- nextReviewAt;
- user feedback records;
- interest evidence;
- bounded preference reinforcement/decay;
- traceable Soul changes.

One interaction must not be able to rewrite long-term identity.

---

## OH-P5 — Autonomous Exploration

AI may spend bounded virtual free time on approved web exploration.

Implement:

- topic selection;
- search/fetch adapter;
- web reading;
- collection/bookmarking;
- structured reflection;
- `maybe_share` intent;
- resource budget and frequency limits.

Do not automate logged-in mobile apps such as Xiaohongshu in this Phase.

---

## OH-P6 — Relationship Feedback Loop

Implement user feedback signals:

- like;
- reply;
- ignore;
- accept/reject suggestion;
- correction of inference;
- review of learned preference.

Feedback influences future behavior but does not directly overwrite Soul.

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
