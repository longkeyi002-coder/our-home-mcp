# OH-P3 — AI World V0.1 Acceptance

Design Reference: OH-11, OH-12, OH-30, OH-31, OH-32, OH-52, OH-60, OH-67, OH-P3.

## Result

OH-P3 proves that AI World continues to exist as a structured, persistent virtual world while the Brain/model is asleep.

It does **not** add Soul, subjective preference evolution, autonomous exploration, or model-driven daily choices. Those remain P4+ work.

Validated Runtime code baseline: `93c61eaffa87737ccdf5afc4eb0518cacc5ea1f0`.

Runtime CI run `33961506239` completed successfully with `npm run check` passing.

## 1. Persistent world state

Canonical AI World state is stored separately from legacy `HomeState` and is explicitly classified as `AI_WORLD/simulated`.

P3 V0.1 state contains:

- synchronized absolute clock on read;
- explicit IANA timezone;
- home;
- high-level virtual location;
- room;
- independent virtual weather;
- work state;
- current activity;
- deterministic phase key;
- transition/update timestamps.

The initial V0.1 virtual location is `our_home`. P3 does not pretend that autonomous city/world travel exists yet.

## 2. Deterministic progression without Brain

`advancePersistedAiWorld()` derives the next state from absolute time + AI World timezone.

The Runtime Life Loop advances AI World before Brain-dependent Care work. A provider outage therefore does not stop deterministic world progression.

Important behavior:

- same phase -> no semantic AI World mutation;
- phase/day change -> one persisted transition;
- virtual weather is deterministic AI World weather, never Earth weather;
- reading `clockAt` does not force per-minute JSON writes;
- AI World advance failure is isolated from Earth Care/Delivery.

## 3. Traceable history and restart continuity

AI World keeps bounded structured history for initialization and state transitions.

Tests prove:

- state survives store restart;
- later catch-up reaches the same deterministic state as direct progression;
- transition history survives restart;
- continuity collections survive deterministic time progression.

## 4. Structured continuity collections

P3 provides structured containers for the complete V0.1 roadmap set:

- task;
- waiting;
- plan;
- idea;
- question;
- hobby;
- interest;
- collection.

Each `AiWorldItem` carries:

- stable id;
- fixed `world=AI_WORLD`;
- explicit provenance;
- `source=AGENT_LIFE`;
- kind;
- title / optional note;
- lifecycle status;
- created/updated timestamps.

The existence of `idea` / `question` containers does not mean P3 automatically generates ideas or questions. Subjective generation belongs to P4 Continuity/Soul.

## 5. Bounded Level-0 MCP surface

P3 exposes four controlled MCP tools:

- `home.get_ai_world`;
- `home.list_ai_world_items`;
- `home.create_ai_world_item`;
- `home.update_ai_world_item`.

Properties:

- read does not mutate or advance the world;
- first bounded write can initialize AI World deterministically even when stdio mode has no Runtime worker;
- callers cannot supply or mutate `world`, `source`, or item `kind` during lifecycle updates;
- MCP-authored semantic items may use bounded `inferred`, `authored`, or `model_generated` provenance;
- deterministic `simulated` provenance remains owned by the Runtime state machine;
- tools cannot notify the user, write Earth observations, operate Android, or perform external side effects.

This is the Level-0 autonomy boundary agreed for AI World.

## 6. Earth / AI World isolation

P3 remains behind the completed world/provenance prerequisite from issue #26.

Automated protection proves:

- AI World/Fiction evidence cannot drive Earth Life State;
- AI World item mutations do not alter Earth observations or actions;
- AI World MCP writes do not enqueue proactive notifications;
- relationship/diary/action/activity reads can be mechanically filtered by world;
- Runtime control-plane records are not canonical world facts merely because they are persisted.

## Automated coverage

Primary P3 tests include:

- `test/ai-world.test.ts`;
- `test/ai-world-store.test.ts`;
- `test/ai-world-worker.test.ts`;
- `test/ai-world-items.test.ts`;
- `test/ai-world-mcp.test.ts`;
- `test/ai-world-mcp-initialize.test.ts`;
- `test/ai-world-p3-completeness.test.ts`;
- world/provenance consumer isolation tests from the P3 hard gate.

## Phase boundary

OH-P3 is complete when the world can keep existing reliably without requiring a personality model.

The following are deliberately **not** P3:

- deciding spontaneously what to study today;
- subjective experience generation;
- Thought Thread;
- preference reinforcement/decay;
- Soul changes;
- autonomous web exploration;
- Earth evidence directly mutating AI World state.

The next phase is OH-P4 Continuity + Soul V0.1, where the person inside this stable world begins forming traceable experiences, thoughts, interests, and bounded long-term preferences.
