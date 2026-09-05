# Our Home — Design → Test Matrix

> Source of truth: `docs/OUR_HOME_DESIGN.md`
>
> This file tracks how design requirements are protected by automated tests or explicit manual acceptance. Tests are derived from design requirements, not used as a substitute for them.

## Status legend

- `COVERED` — automated protection exists and is suitable.
- `PARTIAL` — related test exists but does not fully protect the design rule.
- `TODO` — must be added when the corresponding feature enters implementation.
- `MANUAL` — intentionally requires real-device or human acceptance in addition to automation.

| Design | Requirement | Protection | Status |
|---|---|---|---|
| OH-30 / OH-32 | Earth / AI World / Fiction records cannot leak across factual queries | `world-boundary.test.ts` protects strict observation evidence; `record-boundary.test.ts` protects diary/action/relationship/activity boundaries, approval inheritance and world-filtered reads; `LONG_LIVED_RECORD_BOUNDARY_CLASSIFICATION.md` excludes Runtime control state from canonical memory; P4 preference/Soul corruption is rejected by generic AI World validation; P4.4 reflection input is AI World-only; P4.5 keeps Earth feedback separate from derived AI World evidence | COVERED |
| OH-31 | Long-lived semantic records preserve world/provenance/source/time | Observation schema + `record-boundary.test.ts` + `routine-boundary.test.ts`; diary/action/relationship/activity carry explicit boundaries and RoutineWindow is fixed to `EARTH/user_declared`; P4 continuity/preference/Soul records carry explicit AI World boundaries, timestamps and evidence traces; reflection output binds exact source review evidence; feedback Bridge keeps explicit Earth and AI World records | COVERED |
| OH-40 | Repeated events do not produce wake/message storms | Wake cooldown/dedupe tests + `TelemetryPolicyTest` stable heartbeat bucket ID + Room unique dedupe key instrumentation coverage | COVERED |
| OH-41 | User can correct/delete/revoke/pause and control per-App sensing | Configuration gate + explicit manual fallback + diagnostics copy without credential values; `PresencePrivacyRulesTest` protects per-App identity allow/hide semantics; P4.5 supports bounded corrective feedback; broader pause/delete/revoke controls still pending | PARTIAL |
| OH-42 | Sensitive sensing/credentials are minimized before data leaves Android | `TelemetryPolicyTest`; `PresencePrivacyRulesTest`; `UsagePrivacyFilterTest` covers current App/session/totals/category redaction; register-only enrollment token cannot ingest directly (`phone-enrollment.test.ts`); diagnostics URL query/secret redaction test; Usage Access manual acceptance | PARTIAL / MANUAL |
| OH-43 | Presence distinguishes observed/user-declared/inferred context; stale sessions end on screen/app changes | Presence state/session tests + Runtime Context Understanding tests | TODO / MANUAL |
| OH-44 | Visual observation is curiosity-driven, not fixed high-frequency cron; looking and messaging are separate decisions | Curiosity cooldown/budget/state tests + no-per-transition Brain/Vision regression test | TODO |
| OH-45 | Sensitive Guard blocks protected apps/scenes before upload and cannot be bypassed by Brain/Curiosity; Presence-hidden apps cannot be observed visually; temporary grants expire | Local privacy-policy unit tests + `PresencePrivacyRulesTest` + `VisualCaptureBridge` local Presence gate + secure-window/manual device acceptance + temporary-grant lifecycle tests | TODO / MANUAL |
| OH-46 | Permission onboarding detects current state and routes users to the shortest supported system setting without bypassing OS security; App privacy UI remains simple | Android permission-state/navigation tests + searchable launcher-App list manual acceptance + OPPO/OnePlus real-device manual acceptance | TODO / MANUAL |
| OH-47 | FCM notification opens the intended Our Home Chat/message destination and obeys preview policy | Notification payload/deep-link tests + foreground/background real-device acceptance | TODO / MANUAL |
| OH-50 | Autonomous browsing cannot silently perform external side effects | P5.1 `ai-world-exploration.test.ts` protects the strict public-web-only/no-auth/no-side-effect capability and output contract; concrete provider enforcement and persisted result flow remain future P5 work | PARTIAL |
| OH-51 | Skill/MCP proposal cannot install without approval | Proposal/approval state-machine tests | TODO |
| OH-52 | Risk Level 2/3 actions require confirmation and remain independent from observation permissions | Action policy tests; P3 Level-0 AI World MCP is side-effect isolated; P5.1 exploration contract has no external-action surface; Level 2/3 confirmation policy remains future work | TODO |
| OH-60 | Runtime Core is provider-neutral | `BrainAdapter` compile boundary + mock brain tests; P4.4 adds provider-neutral `AiWorldReflectionAdapter`; P5.1 adds provider-neutral `AiWorldExplorationAdapter`; add import-boundary guard | PARTIAL |
| OH-61 | Daily telemetry survives without control WSS | Android HTTPS queue/upload + auto-config planning tests + compiled Runtime ingest/device auth + register-only enrollment test; real-device validation remains | PARTIAL / MANUAL |
| OH-62 | Remote live read uses separate control path | Relay/Local MCP integration test when migrated | TODO |
| OH-63 | FCM delivery does not depend on WSS | Notifier tests + future disconnected-WSS integration test | PARTIAL |
| OH-64 | Runtime remains event-driven; no high-frequency LLM life loop | WorkManager 15-minute approximate schedule, immediate worker, wake scheduling tests, queue retry/backoff; P4 review maturity/preference/Soul maintenance is deterministic; P4.4 reflection is due/budget gated; P5.1 exploration is free-time/topic gated with one call/cycle, six-hour success cooldown, one-hour failure backoff and two attempts/UTC-day | PARTIAL |
| OH-65 | Model calls are bounded to cognition-worthy work | P4 deterministic maturity/preference/Soul/feedback work is zero-model-cost; P4 reflection has persisted cooldown/backoff/daily budget; P5.1 proves disabled/no-topic/non-free-time exploration makes zero provider calls and persists a separate exploration budget | PARTIAL |
| OH-66 | Runtime/Android state is diagnosable without secret leakage | compiled `/v1/phone/status` tests; staged Android API-error tests; `DiagnosticsReportTest`; periodic/immediate worker state exposed | PARTIAL / MANUAL |
| OH-67 | Provider/tool failures degrade gracefully | FCM/Hermes retry tests + Android Room retry + staged auth errors + production start scripts; AI World deterministic progression is isolated from provider failure; P4 reflection and identity maintenance are failure-isolated; P5.1 provider/contract failure backs off without persisting web output or creating Earth/delivery side effects | PARTIAL |
| OH-68 | Realtime Presence uses event-driven package/screen events, local dedupe/queue, per-App identity redaction before upload, no Accessibility tree retrieval, while UsageEvents remains reconciliation | Accessibility config/service tests + transition dedupe tests + `PresencePrivacyRulesTest` + `UsagePrivacyFilterTest` + Android/Runtime observation-kind contract test + queue tests + real-device verification | TODO / MANUAL |
| OH-69 | Raw screenshot is ephemeral, guarded before provider upload, never placed in ordinary diagnostics/logs, and retries are bounded | Visual pipeline lifecycle/redaction tests + Presence-hidden visual gate + visual-audit package redaction + manual provider failure test | TODO / MANUAL |
| OH-P1 | Real Android observation reaches persisted Life State | Runtime integration tests, Android telemetry/usage/auto-config tests, diagnostics tests and `OH_P1_ACCEPTANCE.md`; actual phone evidence still required | PARTIAL / MANUAL |
| OH-P1.5 | Realtime Presence → local privacy guard → Context → Curiosity → visual guard → optional Visual summary works on a real phone | `OH_PRESENCE_VISUAL_PLAN.md` scenarios A-E + automated policy/session/privacy tests | TODO / MANUAL |
| OH-P2 | Earth change → Wake → Brain → Decision → FCM → Android notification | End-to-end real-device acceptance including destination deep link | TODO / MANUAL |
| OH-P3 | AI World persists while model sleeps | `ai-world*.test.ts` coverage proves deterministic state/history, restart/catch-up, explicit location, complete structured continuity kinds, provider-independent worker progression, bounded MCP access and Earth isolation; acceptance recorded in `OH_P3_ACCEPTANCE.md` | COVERED |
| OH-P4 | Continuity + Soul evolve slowly and traceably | P4.1 continuity tests protect reusable public continuity/no hidden CoT; P4.2 preference tests protect evidence bounds/dedupe/decay; P4.3 Soul tests protect reviewed multi-evidence slow change/audit; P4.4 reflection tests protect sparse model cognition, exact source binding, AI World-only input, strict output, resource bounds and Worker isolation; P4.5 feedback tests protect Earth→AI World evidence translation and no direct Soul overwrite; final worker test proves zero-model-cost review/Soul catch-up; acceptance recorded in `OH_P4_ACCEPTANCE.md` | COVERED |
| OH-P5 | Autonomous exploration produces traceable experience/share intent | P5.1 `ai-world-exploration.test.ts` protects default-off/free-time/topic eligibility, current-phase derivation, provider-neutral read-only capability, strict result schema, restart-safe cooldown/backoff/daily budget and Earth-side-effect isolation; concrete public-web provider, traceable result persistence and maybe-share intent remain pending | PARTIAL |
| OH-P6 | User feedback affects future strategy without direct overwrite | P4.5 feedback substrate and Feedback→Preference→review→Soul tests protect the learning boundary; automatic product-signal capture/strategy adaptation remains P6 | PARTIAL |
| OH-P7 | Remote read and controlled actions are auditable | relay/action policy tests | TODO |

## OH-P1 evidence split

Automated CI protects deterministic rules, but OH-P1 is not complete until a real Android device proves the transport lifecycle.

Automated:

- configuration gate and default-config planning that never overwrites an explicit custom Runtime;
- register-only enrollment token can register but cannot call heartbeat/observations/MCP;
- connection verification requires real registration auth instead of only `/healthz`;
- staged registration/upload/re-registration error classification;
- diagnostics report contains useful state without token values or Runtime URL query secrets;
- periodic and immediate worker states are independently observable;
- fresh foreground-package fallback rejects stale UsageStats evidence;
- stable heartbeat event ID;
- observation provenance/dedupe;
- phone liveness derivation;
- Life State freshness rules;
- compiled production Runtime exposes protected `/v1/phone/status`;
- compiled production Runtime accepts `OUR_HOME_INGEST_TOKEN` directly for protected ingest;
- registered device credentials work for heartbeat/observations;
- production npm start scripts rebuild current source before executing `dist`;
- Android tests + lint + assembleDebug.

Real-device/manual:

- fixed signing identity is established once and future stable APKs preserve the same certificate;
- versionCode increases across user-installable stable builds;
- stable APK upgrades in place without uninstall/re-authorizing permissions;
- default Runtime URL + enrollment token are injected into the private build and first install registers automatically;
- WorkManager actually executes on-device;
- Usage Access granted/denied behavior;
- network loss → Room pending → reconnect upload;
- Runtime receives the phone event over a real HTTPS path;
- diagnostics evidence matches persisted Runtime state.

Procedure: `docs/OH_P1_ACCEPTANCE.md`.

## OH-P1.5 evidence split

Automated:

- package transition debounce/dedupe;
- screen/app session lifecycle;
- no Accessibility UI-tree retrieval configuration;
- per-App Presence identity policy defaults deterministically and is applied before upload;
- periodic heartbeat/usage summaries redact hidden App identity, sessions, totals and categories;
- Presence-hidden App cannot proceed into visual observation;
- visual audit telemetry does not reveal a Presence-hidden package identity;
- per-app visual policy precedence;
- protected category defaults;
- temporary grant expiry on timeout/app switch/lock;
- Curiosity cooldown/budget and no fixed screenshot cron;
- raw visual payload redaction/non-persistence;
- notification destination payload parsing.

Real-device/manual:

- Accessibility enable/disable and OEM permission repair flow;
- OPPO/OnePlus restricted-settings onboarding where applicable;
- privacy page lists and searches the device's normal user-launchable Apps, including Apps not used today, with no fixed 12-App cap;
- recently used Apps sort ahead of otherwise alphabetical Apps without hiding unused Apps;
- changing an App to “不感知” results in only generic private-app state reaching Runtime, never package/label/category identity;
- foreground app transitions arrive near-real-time;
- screen off/on and lock/unlock update Presence;
- Android 11+ screenshot works only after explicit permission and is blocked for protected/Secure windows;
- long dwell can trigger an occasional visual observation without repeated mechanical capture;
- user-declared activity reduces but does not permanently disable later observation;
- sensitive temporary grant expires correctly.

Procedure and scenarios: `docs/OH_PRESENCE_VISUAL_PLAN.md`.

## OH-P3 evidence split

Automated:

- explicit `AI_WORLD/simulated` state/history boundary;
- synchronized read clock without per-minute persistence churn;
- deterministic room/weather/work/activity phase progression from absolute time + IANA timezone;
- explicit V0.1 virtual location independent from room;
- same-phase idempotency;
- phase/day transition history;
- restart/catch-up equivalence;
- Runtime worker progression with no Brain adapter;
- AI World failure isolation from Earth Care/Delivery;
- structured task/waiting/plan/idea/question/hobby/interest/collection persistence;
- item boundary/kind/source immutability through lifecycle updates;
- bounded MCP read/create/update tools;
- first MCP write deterministic initialization when no worker has initialized the world;
- AI World writes cannot alter Earth Life State, observations, actions, or notification queues.

Acceptance: `docs/OH_P3_ACCEPTANCE.md`.

## OH-P4 evidence split

P4.1 automated:

- Experience, Note/Journal and Thought Thread persist as explicit `AI_WORLD` continuity records;
- world/provenance/source/timestamp/evidence references remain structured;
- Thought Thread stores only reusable topic/summary/conclusion/open-question structure and silently discards unknown reasoning/chain-of-thought input fields;
- `nextReviewAt` due listing is deterministic, sorted, read-only and zero-model-cost;
- archived Thought Threads do not remain in due-review lists;
- Experience review can clear/reschedule without rewriting experience content or provenance;
- rescheduling cannot point behind the current review action and create immediate retry churn;
- continuity survives JSON restart and P3 deterministic world phase progression;
- continuity writes cannot alter Earth Life State or proactive-message queues.

Tests: `test/ai-world-continuity.test.ts`, `test/ai-world-continuity-review.test.ts`.
Implementation note: `docs/P4_CONTINUITY_V01.md`.

P4.2 automated:

- interest evidence is explicit `AI_WORLD` memory with stable evidence keys and optional evidence refs;
- one evidence item is hard-capped to a `0.05` score effect;
- duplicate `(interestKey, evidenceKey)` input is idempotent and cannot reinforce twice;
- reducer output is independent of evidence write order;
- score remains bounded in `[-1,1]`;
- non-neutral preference decays toward zero by a deterministic `0.005` per 24 hours;
- seven-day due review is zero-model-cost and stops once preference reaches neutral;
- preference state keeps a bounded recent evidence-ID trace and exact evidence count;
- restart and P3 deterministic phase progression preserve preference memory;
- generic AI World validation rejects corrupt preference/evidence boundaries;
- preference writes/reviews do not alter Earth Life State, observations, actions or notification queues.

Test: `test/ai-world-preference.test.ts`.
Implementation note: `docs/P4_PREFERENCE_V01.md`.

P4.3 automated:

- one evidence item cannot directly alter Soul;
- even multi-evidence preference cannot alter Soul before explicit preference review;
- Soul eligibility requires at least three evidence records and reviewed preference magnitude `>=0.08`;
- a newly accepted canonical evidence set changes Soul by at most `0.02`;
- the same evidence-set basis cannot reinforce/correct twice even after another preference review;
- new counter evidence invalidates the old review for Soul purposes and requires a new review;
- counter evidence uses the same bounded correction rule;
- callers cannot supply arbitrary Soul score/delta;
- backdated Soul changes before preference review/current tendency state fail closed;
- non-neutral Soul decays toward zero by deterministic `0.0002` per 24 hours on a 30-day review cadence;
- Soul change records preserve before/after/delta/reason/preference/evidence basis audit;
- restart and deterministic P3 phase progression preserve Soul state/history;
- generic `assertValidAiWorldData()` rejects corrupt Soul world boundaries, inconsistent audit math, missing/reused bases and preference-derived deltas above the cap;
- Soul writes/reviews cannot alter Earth Life State, observations, actions, Android registration or notification queues.

Tests: `test/ai-world-soul.test.ts`, `test/ai-world-soul-validation.test.ts`.
Implementation note: `docs/P4_SOUL_V01.md`.

P4.4 automated:

- no due Continuity record means zero reflection provider calls;
- Runtime deterministically selects at most one due Experience/Note/Thought Thread per cycle;
- source record and due timestamp are exact-bound before and after the provider call;
- reflection input contains only the AI World source, current AI World state and bounded read-only Soul context;
- Earth Life state/observations/proactive queue are not included in the reflection input;
- only strict `ignore | record_reflection` output is accepted;
- hidden reasoning, messaging actions, Soul-delta fields and arbitrary extras fail closed;
- `record_reflection` persists a public model-generated Thought Thread with exact review-basis evidence reference;
- `ignore` creates no content;
- successful decisions enforce six-hour cooldown; failures enforce one-hour retry backoff; provider attempts are capped at three per UTC day;
- persisted processing/budget state survives restart;
- provider/contract failure leaves the source due and cannot block Earth heartbeat/Care/Delivery;
- Worker performs reflection only when an explicit reflection adapter is supplied; deployment reflection remains disabled by default;
- Hermes reflection uses the configured stable provider identity but Runtime revalidates its output independently.

Tests: `test/ai-world-reflection.test.ts`, `test/ai-world-reflection-worker.test.ts`, `test/hermes-reflection.test.ts`.
Implementation note: `docs/P4_REFLECTION_V01.md`.

P4.5 automated:

- user feedback persists independently as `EARTH/user_declared/RELATIONSHIP`;
- `feedbackKey` duplicate payload is idempotent while conflicting reuse fails closed;
- Runtime owns the feedback signal → evidence direction/strength mapping;
- all feedback-derived evidence remains inside the P4.2 `0.05` single-evidence cap;
- derived InterestEvidence uses a stable feedback-based evidence key and exact Earth feedback reference;
- feedback recording accepts no arbitrary evidence strength, Preference score, Soul score or Soul delta;
- one feedback cannot directly create or modify a Soul tendency;
- repeated feedback forms temporary Preference first and still must pass the seven-day review plus P4.3 evidence/magnitude/dedupe gate;
- restart/crash-window replay cannot reinforce the same feedback twice;
- feedback writes do not alter Earth Life State, notification queue, Android registration, visual request or external state.

Tests: `test/user-feedback.test.ts`, `test/user-feedback-soul-chain.test.ts`.
Implementation note: `docs/P4_USER_FEEDBACK_V01.md`.

Final P4 Runtime integration automated:

- persistent Life Loop executes due Preference review without a model call;
- the worker can only ask the existing P4.3 gate to apply a reviewed Preference basis; it cannot supply an arbitrary Soul delta;
- due Soul review/decay is driven by absolute time and catches up after Runtime downtime;
- identity-maintenance failure is isolated from Earth heartbeat/Wake/Care/Delivery;
- full Feedback → Preference → review → Soul maintenance remains traceable and bounded.

Test: `test/ai-world-identity-worker.test.ts`.
Acceptance: `docs/OH_P4_ACCEPTANCE.md`.

## OH-P5 evidence split

P5.1 automated:

- exploration is disabled by default at the core capability boundary;
- no topic or non-free-time state makes zero provider calls;
- Runtime binds one exact topic from AI World open questions/questions/interests/hobbies/ideas;
- Earth Life observations, phone state and delivery queues are absent from adapter input;
- eligibility derives the deterministic current AI World phase at `asOf` rather than trusting a stale persisted `free_time` snapshot;
- the public-web capability explicitly disables authenticated sessions and external side effects;
- accepted provider output is limited to 1–5 public HTTP(S) URL/title/summary records with no embedded credentials;
- strict schema rejects extra action/hidden-reasoning fields;
- P5.1 does not persist provider output into canonical AI World memory and does not create notifications;
- successful calls have a six-hour cooldown;
- provider/contract failures have a one-hour backoff;
- provider attempts are capped at two per UTC day;
- operational budget/lease state survives restart;
- provider failure remains isolated from Earth/Android state.

Test: `test/ai-world-exploration.test.ts`.
Implementation note: `docs/P5_EXPLORATION_BOUNDARY_V01.md`.

P5 remaining:

- concrete public read-only search/fetch provider;
- traceable Experience/Note/Collection persistence for accepted results;
- structured reflection over explored material;
- separate `maybe_share` intent and Level-1 delivery policy;
- final P5 Phase Review.

## Rule for adding features

When an Issue adds a new design capability:

1. Reference the design ID(s).
2. Add or update a row in this matrix if the capability introduces a new invariant.
3. Add the test before marking the Issue complete.
4. If automation cannot prove the requirement, document the real-device/manual acceptance procedure.

## Rule for bugs

A bug fix should identify which design requirement was violated. The regression test should reference that requirement in its test name or nearby comment when practical.

## Observation and long-lived-record boundary integration review

Design Reference: OH-30/OH-31/OH-32, OH-43/OH-44, OH-66.

- `test/world-boundary.test.ts`: observation migration, unclassified legacy evidence, validation, deduplication/compaction across worlds, bounded Earth context and pending legacy decisions.
- `test/world-consumers.test.ts`: context understanding, visual budgets/requests, phone liveness and MCP observation-world isolation.
- `test/record-boundary.test.ts`: long-lived semantic record legality, fail-closed compatibility writes, relationship approval inheritance and world-filtered reads.
- `test/routine-boundary.test.ts`: fixed Earth/user-declared routine semantics and deterministic normalization of older routine records.
- `test/phone-http.test.ts`: compiled phone HTTP routes reject explicit fictional provenance.
- Canonical-memory vs Runtime-control classification: `docs/LONG_LIVED_RECORD_BOUNDARY_CLASSIFICATION.md`.
- P3 prerequisite decision: `docs/WORLD_BOUNDARY_PHASE_REVIEW.md`.
