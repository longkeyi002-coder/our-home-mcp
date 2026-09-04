# World Model and Memory Truth Rules

The system contains two real domains of record: **Earth Reality** and **AI World**. They are both persistent, but they are not interchangeable.

## Required provenance classes

Every long-lived memory/event/state should be attributable to one of these classes.

### EARTH_REALITY

Observed by a real system or a verified external source.

Examples:

- Android reports battery=42
- UsageStats reports a foreground package
- a weather provider reports rain in Tokyo
- a fetched webpage contains a specific title

### USER_DECLARED

Explicitly stated by the user.

Example:

- user says “I am tired today”

This is a trusted user statement, but it is not the same as independent sensor verification.

### INFERRED

A conclusion or guess derived from other evidence.

Examples:

- “the user may be preparing to sleep”
- “this article is probably relevant to the user”

Inference must never be silently upgraded to EARTH_REALITY.

### AI_WORLD

A fact that is true inside the AI's persistent virtual world.

Examples:

- it is raining near the AI's virtual home
- the AI is in its study
- the AI is working today
- the AI added a photo to its own collection

These are valid AI-world facts, but they cannot be used as evidence about Earth.

### FICTION

Hypothetical, imagined, role-play or story content.

Fiction may influence creative behavior but must not enter either Earth factual memory or AI-world canonical history unless an explicit world-authoring action promotes it.

## Suggested record shape

```ts
type WorldScope = "earth" | "ai_world" | "fiction"
type EvidenceClass = "observed" | "user_declared" | "inferred" | "simulated" | "authored"

type MemoryRecord = {
  id: string
  world: WorldScope
  evidenceClass: EvidenceClass
  source: string
  content: string
  observedAt: string
  confidence?: number
  evidenceRefs?: string[]
}
```

The exact storage schema may change, but these semantic boundaries must remain.

## Cross-world rules

1. AI World weather cannot answer a question about Earth weather.
2. AI World events cannot prove user behavior.
3. Earth observations may influence AI World actions.
4. AI World plans may produce Earth-side actions only through an explicit Runtime decision/action path.
5. Inference must remain labeled inference.
6. User-declared information must preserve who said it and when.
7. A webpage fetched by the AI is an Earth-side external observation; the AI's act of reading it is an AI World activity. One event may therefore produce records in both worlds with different meanings.

## Example: browsing the web

```text
AI World:
20:10 — AI sits in its virtual study and chooses to browse photography.

Earth/external reality:
20:12 — Browser adapter fetched an article from example.com.

AI World:
20:14 — AI likes the article and adds it to its collection.
20:15 — AI creates a structured intent: maybe share it with the user.
```

The article metadata is external reality. The virtual study, liking and collection are AI World facts.

## Example: virtual weather

```text
AI World weather: light rain
Earth weather (Tokyo): unknown until a real weather source is queried
```

The system must never answer “Tokyo is raining” using AI World weather.

## Memory promotion

A record may change status only through an explicit rule.

Examples:

- INFERRED → EARTH_REALITY only after new observed evidence confirms it.
- FICTION → AI_WORLD only when a world-authoring event explicitly makes it canonical.
- USER_DECLARED remains user-declared even if the Runtime considers it highly reliable.

## Brain prompt contract

Every BrainAdapter should be told which inputs are:

- Earth observations
- user declarations
- inferences
- AI World state
- fiction/hypothetical context

The Brain should not be expected to recover these boundaries from prose alone.
