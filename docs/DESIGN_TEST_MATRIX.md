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
| OH-30 / OH-32 | Earth / AI World / Fiction records cannot leak across factual queries | AI World schema/query tests still pending; phone liveness already ignores non-phone/inferred records in `phone-status.test.ts` | PARTIAL |
| OH-31 | Long-lived records preserve provenance/source/time | Observation persistence tests + `phone-status.test.ts` derive liveness only from persisted `source=phone` observations without exposing credentials | PARTIAL |
| OH-40 | Repeated events do not produce wake/message storms | Wake cooldown/dedupe tests + `TelemetryPolicyTest` stable heartbeat bucket ID + Room unique dedupe key instrumentation coverage | COVERED |
| OH-41 | User can correct/delete/revoke/pause | Configuration gate + explicit manual fallback + diagnostics copy without credential values; broader pause/delete/revoke controls still pending | PARTIAL |
| OH-42 | Sensitive sensing/credentials are minimized | `TelemetryPolicyTest`; register-only enrollment token cannot ingest directly (`phone-enrollment.test.ts`); diagnostics URL query/secret redaction test; Usage Access manual acceptance | PARTIAL / MANUAL |
| OH-50 | Autonomous browsing cannot silently perform external side effects | Capability policy tests | TODO |
| OH-51 | Skill/MCP proposal cannot install without approval | Proposal/approval state-machine tests | TODO |
| OH-52 | Risk Level 2/3 actions require confirmation | Action policy tests | TODO |
| OH-60 | Runtime Core is provider-neutral | `BrainAdapter` compile boundary + mock brain tests; add import-boundary guard | PARTIAL |
| OH-61 | Daily telemetry survives without control WSS | Android HTTPS queue/upload + auto-config planning tests + compiled Runtime ingest/device auth + register-only enrollment test; real-device validation remains | PARTIAL / MANUAL |
| OH-62 | Remote live read uses separate control path | Relay/Local MCP integration test when migrated | TODO |
| OH-63 | FCM delivery does not depend on WSS | Notifier tests + future disconnected-WSS integration test | PARTIAL |
| OH-64 | Runtime remains event-driven; no high-frequency LLM life loop | WorkManager 15-minute approximate schedule, immediate worker, wake scheduling tests, queue retry/backoff | PARTIAL |
| OH-65 | Model calls are bounded to cognition-worthy work | Resource-budget tests when budget layer exists | TODO |
| OH-66 | Runtime/Android state is diagnosable without secret leakage | compiled `/v1/phone/status` tests; staged Android API-error tests; `DiagnosticsReportTest`; periodic/immediate worker state exposed | PARTIAL / MANUAL |
| OH-67 | Provider/tool failures degrade gracefully | FCM/Hermes retry tests + Android Room retry + staged auth errors + production start scripts rebuild current source before `dist`; AI World deterministic progression pending | PARTIAL |
| OH-P1 | Real Android observation reaches persisted Life State | Runtime integration tests, Android telemetry/usage/auto-config tests, diagnostics tests and `OH_P1_ACCEPTANCE.md`; actual phone evidence still required | PARTIAL / MANUAL |
| OH-P2 | Earth change → Wake → Brain → Decision → FCM → Android | End-to-end real-device acceptance | TODO / MANUAL |
| OH-P3 | AI World persists while model sleeps | restart/persistence + deterministic simulation tests | TODO |
| OH-P4 | Soul evolves slowly and traceably | preference reinforcement/decay/provenance tests | TODO |
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

## Rule for adding features

When an Issue adds a new design capability:

1. Reference the design ID(s).
2. Add or update a row in this matrix if the capability introduces a new invariant.
3. Add the test before marking the Issue complete.
4. If automation cannot prove the requirement, document the real-device/manual acceptance procedure.

## Rule for bugs

A bug fix should identify which design requirement was violated. The regression test should reference that requirement in its test name or nearby comment when practical.
