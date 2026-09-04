# Rebuild Roadmap

This roadmap applies only to `rebuild/ai-life-runtime-v01`.

## Phase 0 — Clean Foundation

Goal: stop feature sprawl and make the repository provider-neutral.

- establish `BrainAdapter`
- clean docs and duplicate workflows
- define Earth / AI World / provenance rules
- keep `main` and old PR branches as references only
- do not add new product features

Acceptance:

- Node checks run on rebuild branch
- Android tests + assembleDebug + lint run on rebuild branch
- no new Hermes-specific dependency in Runtime Core
- no hardcoded long-lived public token/device identity

## Phase 1 — Earth Telemetry

Goal: phone state reaches Runtime automatically.

```text
Android sensing
→ local queue
→ HTTPS ingest
→ persisted observation
→ device lastSeen
→ Life State
```

Required:

- battery
- charging
- connectivity
- foreground package / usage summary
- retry / dedupe
- diagnostics

## Phase 2 — Life State and Wake

Goal: raw observations become meaningful, bounded changes.

Initial wake types:

- became_active
- became_idle
- charging_started
- battery_low
- device_offline
- long_usage_session

Required:

- baseline behavior
- cooldown/dedupe
- retry
- no wake storm from repeated heartbeat

## Phase 3 — AI World V0.1

Goal: the AI has persistent virtual life independent of the current provider.

Minimum state:

- virtual clock
- home/location
- local virtual weather
- work state
- current activity
- hobbies/interests
- collection/bookmarks
- structured task/waiting/plan/idea items

Important:

- AI World state must never become Earth Reality by accident
- inexpensive deterministic simulation should not require a model call

## Phase 4 — Brain and Thought Continuity

Goal: a replaceable Brain can respond to Wake Events and update structured continuity.

Start with mock/manual BrainAdapter, then connect one real provider.

Required decisions:

- ignore
- remember/update structured memory
- update thought/task thread
- notify

Provider failure must leave the Wake Event retryable.

## Phase 5 — Proactive Delivery

Goal: a real event can lead to a real phone notification.

```text
Earth event
→ Life State
→ Wake Event
→ BrainAdapter
→ notification decision
→ FCM
→ Android notification
```

Event trace must expose each step without leaking secrets.

## Phase 6 — Remote Phone Read

Goal: on-demand real device state read.

```text
Remote client
→ Relay
→ Android outbound WSS
→ Local MCP
→ get_device_context
→ response
```

This is the Control Plane, not the primary telemetry mechanism.

## Phase 7 — Autonomous Interests and Browsing

Goal: AI can spend selected virtual free time on its own interests.

Examples:

- choose a hobby/topic
- browse allowed web sources
- save items into its own collection
- form a structured “maybe share with user” intent
- share only when policy/context says it is appropriate

Start with web/browser sources. Mobile-app automation such as automatically operating Xiaohongshu is a later, separately reviewed capability because it involves login state, platform rules, account safety and device-control permissions.

## Explicitly deferred

Until the above foundation is stable:

- screenshots / OCR
- Accessibility automation
- arbitrary coordinate tapping
- reading private chat contents
- automatic purchases/payments
- silent permission escalation
- permanent exact GPS tracking

## V0.1 completion

V0.1 is complete only when both are proven:

1. `Android observation → Runtime → Wake → Brain → Thought/Decision → FCM notification`
2. `Remote client → Relay → Android → Local MCP → response`

The selected Brain Provider must be replaceable without rebuilding either chain.
