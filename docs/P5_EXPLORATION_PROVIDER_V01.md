# P5.2 — Read-only Web Provider + Traceable Exploration Memory V0.1

Design reference: OH-01, OH-20/21/22/23, OH-30/31/32, OH-50, OH-52, OH-60, OH-64/65/67, OH-P5.

## Purpose

P5.1 proved the deterministic capability gate. P5.2 adds the first concrete network adapter and the first canonical AI World memory produced by exploration.

The boundary remains intentionally narrow:

```text
AI World free time
→ P5.1 topic/resource gate
→ read-only public search gateway (GET only)
→ strict bounded result
→ exact-topic revalidation
→ AI World Experience + Collection
```

This is not a general browser agent.

## Concrete network adapter

`PublicWebSearchHttpAdapter` talks to a separately configured read-only search gateway.

Runtime behavior:

- GET only;
- exact Runtime-bound topic is sent as `q`;
- result count is bounded to the P5.1 source limit;
- no request body;
- no Authorization header;
- no Cookie/session header;
- redirects are rejected;
- timeout is bounded;
- response bytes are bounded while streaming;
- gateway JSON is strict and bounded;
- source URLs must be HTTP(S) and contain no embedded credentials.

Runtime does **not** follow arbitrary result URLs in P5.2. That avoids turning the Runtime into an SSRF-capable general fetcher before a dedicated network-address policy exists.

## Exploration memory

`PersistingAiWorldExplorationAdapter` decorates any P5 adapter.

A valid completed result is persisted **before** P5.1 records the provider call as successful. This ordering prevents a successful Runtime budget state from existing without the corresponding learning record.

Accepted results create:

1. one `AI_WORLD/model_generated/AGENT_LIFE` Experience describing that the AI explored the bound topic and which public sources it read;
2. one `collection` item per unique `(topic, URL)` source containing the public URL, topic and bounded provider summary.

The records describe **what the AI read**. They are not promoted to `EARTH/observed` facts and cannot affect Earth Life State.

## Traceability and dedupe

- Experience id is deterministic from the topic key + canonical source URL set.
- Collection id is deterministic from topic key + source URL.
- Same topic/source replay after restart is idempotent.
- Long URLs use a hash evidence ref when the direct ref would exceed the existing continuity evidence-ref bound; the collection still retains the bounded public URL text.
- Before persistence, Runtime re-checks that the exact source question/interest/hobby/idea or Thought Thread is still active and unchanged.
- If the topic changes while the provider is running, persistence fails closed.

Because memory commit happens before P5.1 success-state commit, a crash after memory persistence can cause a later provider retry after lease/backoff recovery, but deterministic ids prevent duplicate canonical memory.

## Not allowed

P5.2 does not add:

- arbitrary URL fetching by Runtime;
- authenticated browsing;
- cookies or login sessions;
- posting/publishing;
- purchasing/payment;
- external messages;
- Android/App automation;
- Skill/MCP installation;
- automatic proactive notification;
- `maybe_share` intent;
- direct Preference/Soul mutation.

## Tests

`test/ai-world-exploration-provider.test.ts` protects:

- exact GET query and absence of auth/cookie/session state;
- invalid endpoint fail-closed behavior before network I/O;
- response byte limit;
- traceable AI World Experience/Collection persistence;
- Earth Life State, notifications, Android registration and Soul isolation;
- restart/idempotent source memory;
- topic mutation during provider call;
- side-effect/hidden-reasoning-shaped output never reaching memory.

P5.1 resource gate tests remain authoritative for free-time eligibility, cooldown, failure backoff and daily provider budget.

## Next boundary

P5.3 may wire this capability into the Runtime Life Loop behind an explicit deployment flag and add a separate `maybe_share` intent lifecycle. Exploration and sharing must remain separate decisions: reading something does not imply contacting the user.
