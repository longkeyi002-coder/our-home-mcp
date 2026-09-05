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
| OH-30 / OH-32 | Earth / AI World / Fiction records cannot leak across factual queries | `world-boundary.test.ts` protects strict observation evidence; `record-boundary.test.ts` protects diary/action/relationship/activity boundaries, approval inheritance and world-filtered reads; `LONG_LIVED_RECORD_BOUNDARY_CLASSIFICATION.md` excludes Runtime control state from canonical memory | COVERED |
| OH-31 | Long-lived semantic records preserve world/provenance/source/time | Observation schema + `record-boundary.test.ts` + `routine-boundary.test.ts`; diary/action/relationship/activity carry explicit boundaries and RoutineWindow is fixed to `EARTH/user_declared` | COVERED |
| OH-40 | Repeated events do not produce wake/message storms | Wake cooldown/dedupe tests + `TelemetryPolicyTest` stable heartbeat bucket ID + Room unique dedupe key instrumentation coverage | COVERED |
| OH-41 | User can correct/delete/revoke/pause and control per-App sensing | Configuration gate + explicit manual fallback + diagnostics copy without credential values; `PresencePrivacyRulesTest` protects per-App identity allow/hide semantics; broader pause/delete/revoke controls still pending | PARTIAL |
| OH-42 | Sensitive sensing/credentials are minimized before data leaves Android | `TelemetryPolicyTest`; `PresencePrivacyRulesTest`; `UsagePrivacyFilterTest` covers current App/session/totals/category redaction; register-only enrollment token cannot ingest directly (`phone-enrollment.test.ts`); diagnostics URL query/secret redaction test; Usage Access manual acceptance | PARTIAL / MANUAL |
| OH-43 | Presence distinguishes observed/user-declared/inferred context; stale sessions end on screen/app changes | Presence state/session tests + Runtime Context Understanding tests | TODO / MANUAL |
| OH-44 | Visual observation is curiosity-driven, not fixed high-frequency cron; looking and messaging are separate decisions | Curiosity cooldown/budget/state tests + no-per-transition Brain/Vision regression test | TODO |
| OH-45 | Sensitive Guard blocks protected apps/scenes before upload and cannot be bypassed by Brain/Curiosity; Presence-hidden apps cannot be observed visually; temporary grants expire | Local privacy-policy unit tests + `PresencePrivacyRulesTest` + `VisualCaptureBridge` local Presence gate + secure-window/manual device acceptance + temporary-grant lifecycle tests | TODO / MANUAL |
| OH-46 | Permission onboarding detects current state and routes users to the shortest supported system setting without bypassing OS security; App privacy UI remains simple | Android permission-state/navigation tests + searchable launcher-App list manual acceptance + OPPO/OnePlus real-device manual acceptance | TODO / MANUAL |
| OH-47 | FCM notification opens the intended Our Home Chat/message destination and obeys preview policy | Notification payload/deep-link tests + foreground/background real-device acceptance | TODO / MANUAL |
| OH-50 | Autonomous browsing cannot silently perform external side effects | Capability policy tests | TODO |
| OH-51 | Skill/MCP proposal cannot install without approval | Proposal/approval state-machine tests | TODO |
| OH-52 | Risk Level 2/3 actions require confirmation and remain independent from observation permissions | Action policy tests; P3 Level-0 AI World MCP is side-effect isolated, but Level 2/3 confirmation policy remains future work | TODO |
| OH-60 | Runtime Core is provider-neutral | `BrainAdapter` compile boundary + mock brain tests; add import-boundary guard | PARTIAL |
| OH-61 | Daily telemetry survives without control WSS | Android HTTPS queue/upload + auto-config planning tests + compiled Runtime ingest/device auth + register-only enrollment test; real-device validation remains | PARTIAL / MANUAL |
| OH-62 | Remote live read uses separate control path | Relay/Local MCP integration test when migrated | TODO |
| OH-63 | FCM delivery does not depend on WSS | Notifier tests + future disconnected-WSS integration test | PARTIAL |
| OH-64 | Runtime remains event-driven; no high-frequency LLM life loop | WorkManager 15-minute approximate schedule, immediate worker, wake scheduling tests, queue retry/backoff; P4 review maturity is deterministic/read-only and does not invoke Brain | PARTIAL |
| OH-65 | Model calls are bounded to cognition-worthy work | P4 `nextReviewAt` maturity is zero-model-cost and does not itself wake Brain; broader resource-budget layer remains pending | PARTIAL |
| OH-66 | Runtime/Android state is diagnosable without secret leakage | compiled `/v1/phone/status` tests; staged Android API-error tests; `DiagnosticsReportTest`; periodic/immediate worker state exposed | PARTIAL / MANUAL |
| OH-67 | Provider/tool failures degrade gracefully | FCM/Hermes retry tests + Android Room retry + staged auth errors + production start scripts; `ai-world-worker.test.ts` proves deterministic AI World progression is independent from Brain/provider availability and isolated from Earth delivery failure | PARTIAL |
| OH-68 | Realtime Presence uses event-driven package/screen events, local dedupe/queue, per-App identity redaction before upload, no Accessibility tree retrieval, while UsageEvents remains reconciliation | Accessibility config/service tests + transition dedupe tests + `PresencePrivacyRulesTest` + `UsagePrivacyFilterTest` + Android/Runtime observation-kind contract test + queue tests + real-device verification | TODO / MANUAL |
| OH-69 | Raw screenshot is ephemeral, guarded before provider upload, never placed in ordinary diagnostics/logs, and retries are bounded | Visual pipeline lifecycle/redaction tests + Presence-hidden visual gate + visual-audit package redaction + manual provider failure test | TODO / MANUAL |
| OH-P1 | Real Android observation reaches persisted Life State | Runtime integration tests, Android telemetry/usage/auto-config tests, diagnostics tests and `OH_P1_ACCEPTANCE.md`; actual phone evidence still required | PARTIAL / MANUAL |
| OH-P1.5 | Realtime Presence → local privacy guard → Context → Curiosity → visual guard → optional Visual summary works on a real phone | `OH_PRESENCE_VISUAL_PLAN.md` scenarios A-E + automated policy/session/privacy tests | TODO / MANUAL |
| OH-P2 | Earth change → Wake → Brain → Decision → FCM → Android notification | End-to-end real-device acceptance including destination deep link | TODO / MANUAL |
| OH-P3 | AI World persists while model sleeps | `ai-world*.test.ts` coverage proves deterministic state/history, restart/catch-up, explicit location, complete structured continuity kinds, provider-independent worker progression, bounded MCP access and Earth isolation; acceptance recorded in `OH_P3_ACCEPTANCE.md` | COVERED |
| OH-P4 | Continuity + Soul evolve slowly and traceably | P4.1 `ai-world-continuity*.test.ts` covers Experience/Journal/Thought Thread, nextReviewAt lifecycle, no hidden chain-of-thought persistence, restart and Earth isolation; interest evidence + bounded preference/Soul evolution remain pending | PARTIAL |
| OH-P5 | Autonomous exploration produces traceable experience/share intent | browser adapter + intent tests | TODO |
| OH-P6 | User feedback affects future strategy without direct overwrite | feedback evidence/update tests | TODO |
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

P4 remaining:

- interest evidence;
- bounded preference reinforcement/decay;
- traceable Soul changes;
- user feedback learning;
- review/reflect cognition policy.

Implementation note: `docs/P4_CONTINUITY_V01.md`.

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
