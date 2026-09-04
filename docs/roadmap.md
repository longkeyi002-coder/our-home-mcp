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
- quiet/ignore policy foundations.

---

## OH-P3 — AI World V0.1

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

Deterministic state progression must not require a model call.

World/provenance separation tests are mandatory before Phase completion.

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

Remote live-read/control can progress in parallel after the life chain is stable, but it must not become the dependency that keeps Earth telemetry alive.
