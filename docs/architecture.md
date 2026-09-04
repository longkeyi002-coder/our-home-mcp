# AI Life Runtime Architecture

## Purpose

AI Life Runtime keeps two worlds running without binding the system to one model provider.

- **Earth**: the user's real world.
- **AI World**: the AI's own persistent virtual world.
- **Runtime**: the bridge, state machine, memory boundary, wake system and delivery layer between them.
- **BrainAdapter**: a replaceable thinking provider.

## System map

```text
Earth sources
Android / calendar / weather / web
             │
             ▼
      Observation Ingest
             │
             ▼
        Earth Life State
             │
             ├──────────────┐
             ▼              │
         Wake Engine        │
             │              │
             ▼              │
        BrainAdapter        │
             │              │
             ▼              │
   Decision / Thought Thread│
             │              │
     ┌───────┴────────┐     │
     ▼                ▼     │
AI World update   Earth action / notification
     │                      │
     └────────── Runtime ───┘
```

## Runtime responsibilities

Runtime must own:

- device registration
- observation ingestion
- source/provenance validation
- Life State derivation
- Wake Event creation, dedupe and retry
- AI World state persistence
- structured thought/task persistence
- notification/action queues
- audit/event trace
- transport adapters
- BrainAdapter invocation policy

Runtime must **not** depend on hidden model state to remain alive.

## BrainAdapter boundary

```ts
interface BrainAdapter {
  evaluate(input: BrainInput): Promise<WakeDecision>
}
```

A BrainAdapter may be backed by:

- Hermes
- OpenAI / GPT
- Claude
- a local model
- a self-hosted Agent
- a generic HTTP service

Changing the BrainAdapter must not require rewriting Android sensing, Life State, Wake Engine, AI World or delivery.

## Earth plane

### Telemetry

Low-cost, phone-initiated state summaries:

```text
Android → HTTPS → Runtime
```

Examples:

- battery
- charging
- connectivity
- foreground package
- usage summary
- later: coarse location state / calendar summary

### Control

On-demand, remote device reads or explicit actions:

```text
Remote client → Relay → Android outbound WSS → Local MCP
```

This is not the primary life-sensing channel.

### Delivery

Proactive messages:

```text
Runtime → FCM → Android notification
```

Delivery must continue to work even if the control WebSocket is temporarily disconnected.

## AI World plane

AI World is persistent structured state, not a single endless chat transcript.

Suggested domains:

```text
world/
  clock
  weather
  location
  home
  work
  hobbies
  currentActivity
  inventory/collections
  social/world events
  tasks
  waiting items
  plans
```

The simulator may advance inexpensive deterministic state without invoking a model. The Brain is called only when interpretation, choice or creative thought is needed.

## Thought continuity

Persist structured items such as:

```ts
type ThoughtThreadItem = {
  id: string
  kind: "task" | "waiting" | "plan" | "idea" | "question"
  title: string
  summary: string
  status: "open" | "waiting" | "done" | "dropped"
  createdAt: string
  updatedAt: string
  nextReviewAt?: string
  relatedWakeEventIds: string[]
}
```

Do not store hidden chain-of-thought. Store only user-visible, structured conclusions, intentions, tasks, plans and waiting state.

## Persistence

Current JSON storage is a prototype. New work should move toward a transactional SQLite WAL abstraction while preserving schema migration tests and crash recovery.

## Security

- never hardcode long-lived tunnel tokens
- never commit provider API keys or FCM service-account credentials
- per-device credentials must be rotatable and revocable
- diagnostics must redact secrets
- sensitive actions require explicit approval and auditability

## End-to-end acceptance

### Life chain

```text
Android observation
→ Runtime
→ Life State
→ Wake Event
→ BrainAdapter
→ Thought/Decision
→ FCM
→ Android notification
```

### Remote device chain

```text
Remote client
→ Relay
→ Android WSS
→ Local MCP
→ response
```

Both chains must be real and observable before calling V0.1 complete.
