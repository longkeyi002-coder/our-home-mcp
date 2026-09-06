import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldItem, updateAiWorldItem } from "../src/ai-world-items.js";
import {
  PersistingAiWorldExplorationAdapter,
  persistAiWorldExplorationResult,
} from "../src/ai-world-exploration-memory.js";
import {
  runAiWorldExplorationCycle,
  type AiWorldExplorationAdapter,
  type AiWorldExplorationInput,
} from "../src/ai-world-exploration.js";
import { PublicWebSearchHttpAdapter } from "../src/public-web-search.js";
import { JsonStore } from "../src/store.js";

const FREE_TIME = "2026-09-05T20:00:00.000Z";

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-exploration-provider-"));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, FREE_TIME, "UTC");
  const question = await addAiWorldItem(store, {
    kind: "question",
    title: "为什么有些建筑会让人感觉更安静？",
    note: "想看看公共网页里关于空间、光线和材料的解释。",
    provenance: "authored",
  }, FREE_TIME);
  return { store, filePath, question };
}

function successfulResult() {
  return {
    status: "completed" as const,
    sources: [{
      url: "https://example.org/public-architecture-note",
      title: "Public architecture note",
      summary: "A bounded summary about spatial calm.",
    }],
  };
}

test("OH-50/P5.2: concrete public Web adapter sends exact GET query with no auth/cookie/session state", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return new Response(JSON.stringify({ results: successfulResult().sources }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const adapter = new PublicWebSearchHttpAdapter({
    endpoint: "https://search.example.org/api/search?fixed=1",
    fetchImpl,
  });
  const input: AiWorldExplorationInput = {
    topic: {
      sourceType: "item",
      sourceId: "question-1",
      sourceKind: "question",
      text: "quiet architecture",
      topicKey: "item:question-1:question",
    },
    aiWorld: {
      observedAt: FREE_TIME,
      state: {
        world: "AI_WORLD",
        provenance: "simulated",
        timezone: "UTC",
        home: "our_home",
        location: "our_home",
        room: "living_room",
        weather: "clear",
        workState: "off_duty",
        currentActivity: "free_time",
        phaseKey: "2026-09-05:free_time",
        lastTransitionAt: FREE_TIME,
        updatedAt: FREE_TIME,
      },
    },
    capability: {
      publicWebOnly: true,
      authenticatedSessions: false,
      externalSideEffects: false,
      maxSources: 5,
    },
  };

  const result = await adapter.explore(input);
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.origin + calls[0]!.url.pathname, "https://search.example.org/api/search");
  assert.equal(calls[0]!.url.searchParams.get("fixed"), "1");
  assert.equal(calls[0]!.url.searchParams.get("q"), "quiet architecture");
  assert.equal(calls[0]!.url.searchParams.get("limit"), "5");
  assert.equal(calls[0]!.init.method, "GET");
  assert.equal(calls[0]!.init.redirect, "error");
  assert.deepEqual(calls[0]!.init.headers, { accept: "application/json" });
  assert.equal("body" in calls[0]!.init, false);
  const serializedHeaders = JSON.stringify(calls[0]!.init.headers).toLowerCase();
  assert.doesNotMatch(serializedHeaders, /authorization|cookie|session/);
});

test("OH-50/P5.2: invalid endpoint configuration and oversized responses fail closed", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  assert.throws(() => new PublicWebSearchHttpAdapter({ endpoint: "file:///tmp/search", fetchImpl }), /HTTP/);
  assert.throws(() => new PublicWebSearchHttpAdapter({ endpoint: "https://user:pass@example.org/search", fetchImpl }), /credentials/);
  assert.equal(calls, 0);

  const oversized = new PublicWebSearchHttpAdapter({
    endpoint: "https://search.example.org/search",
    maxResponseBytes: 1_024,
    fetchImpl: (async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "2048" },
    })) as typeof fetch,
  });
  await assert.rejects(() => oversized.explore({
    topic: { sourceType: "item", sourceId: "q", sourceKind: "question", text: "x", topicKey: "item:q:question" },
    aiWorld: { observedAt: FREE_TIME, state: {
      world: "AI_WORLD", provenance: "simulated", timezone: "UTC", home: "our_home", location: "our_home",
      room: "living_room", weather: "clear", workState: "off_duty", currentActivity: "free_time",
      phaseKey: "2026-09-05:free_time", lastTransitionAt: FREE_TIME, updatedAt: FREE_TIME,
    } },
    capability: { publicWebOnly: true, authenticatedSessions: false, externalSideEffects: false, maxSources: 5 },
  }), /byte limit/);
});

test("OH-22/OH-30/OH-P5: accepted exploration creates traceable AI World Experience and Collection only", async () => {
  const { store, question } = await createStore();
  const earthBefore = store.getLifeContext(FREE_TIME);
  const before = store.snapshot();
  const inner: AiWorldExplorationAdapter = { async explore() { return successfulResult(); } };
  const adapter = new PersistingAiWorldExplorationAdapter(store, inner);

  const result = await runAiWorldExplorationCycle(store, adapter, FREE_TIME, true);
  assert.equal(result.status, "completed");
  assert.equal(result.topic?.sourceId, question.id);

  const after = store.snapshot();
  const experience = after.aiWorld?.continuity?.experiences[0];
  assert.equal(experience?.world, "AI_WORLD");
  assert.equal(experience?.provenance, "model_generated");
  assert.match(experience?.summary ?? "", /Explored public Web sources/);
  assert.ok(experience?.evidenceRefs?.some((ref) => ref.includes(result.topic!.topicKey)));
  assert.ok(experience?.evidenceRefs?.some((ref) => ref.includes("https://example.org/public-architecture-note")));

  const collection = after.aiWorld?.items?.find((item) => item.kind === "collection");
  assert.equal(collection?.world, "AI_WORLD");
  assert.equal(collection?.provenance, "model_generated");
  assert.match(collection?.note ?? "", /Public URL: https:\/\/example\.org/);
  assert.match(collection?.note ?? "", /Provider summary:/);

  assert.deepEqual(store.getLifeContext(FREE_TIME), earthBefore);
  assert.equal(after.observations.length, before.observations.length);
  assert.equal(after.proactiveQueue.length, before.proactiveQueue.length);
  assert.deepEqual(after.phoneDeviceRegistrations, before.phoneDeviceRegistrations);
  assert.deepEqual(after.aiWorld?.continuity?.soulTendencies ?? [], before.aiWorld?.continuity?.soulTendencies ?? []);
  assert.deepEqual(after.aiWorld?.continuity?.soulChanges ?? [], before.aiWorld?.continuity?.soulChanges ?? []);
});

test("OH-22/OH-67/P5.2: topic+URL exploration memory is idempotent across restart", async () => {
  const { store, filePath, question } = await createStore();
  const input: AiWorldExplorationInput = {
    topic: {
      sourceType: "item",
      sourceId: question.id,
      sourceKind: "question",
      text: `${question.title}: ${question.note}`,
      topicKey: `item:${question.id}:question`,
    },
    aiWorld: {
      observedAt: FREE_TIME,
      state: structuredClone(store.snapshot().aiWorld!.state),
    },
    capability: { publicWebOnly: true, authenticatedSessions: false, externalSideEffects: false, maxSources: 5 },
  };

  const first = await persistAiWorldExplorationResult(store, input, successfulResult());
  assert.equal(first.collections.length, 1);
  const reopened = await JsonStore.open(filePath, false);
  const second = await persistAiWorldExplorationResult(reopened, input, successfulResult());
  assert.equal(second.experience.id, first.experience.id);
  assert.equal(second.collections[0]!.id, first.collections[0]!.id);

  const snapshot = reopened.snapshot();
  assert.equal(snapshot.aiWorld?.continuity?.experiences.filter((item) => item.id === first.experience.id).length, 1);
  assert.equal(snapshot.aiWorld?.items?.filter((item) => item.id === first.collections[0]!.id).length, 1);
});

test("OH-22/OH-67/P5.2: topic mutation during provider call rejects persistence and leaves no partial memory", async () => {
  const { store, question } = await createStore();
  const inner: AiWorldExplorationAdapter = {
    async explore() {
      await updateAiWorldItem(store, question.id, { title: "这个问题已经改变了" }, "2026-09-05T20:00:01.000Z");
      return successfulResult();
    },
  };
  const result = await runAiWorldExplorationCycle(
    store,
    new PersistingAiWorldExplorationAdapter(store, inner),
    FREE_TIME,
    true,
  );
  assert.equal(result.status, "provider_failed");
  assert.equal(store.snapshot().aiWorld?.continuity?.experiences.length ?? 0, 0);
  assert.equal(store.snapshot().aiWorld?.items?.filter((item) => item.kind === "collection").length ?? 0, 0);
});

test("OH-50/OH-52/P5.2: invalid side-effect-shaped provider output is never persisted", async () => {
  const { store } = await createStore();
  const malicious: AiWorldExplorationAdapter = {
    async explore() {
      return {
        ...successfulResult(),
        action: "publish",
        chainOfThought: "hidden reasoning",
      };
    },
  };
  const result = await runAiWorldExplorationCycle(
    store,
    new PersistingAiWorldExplorationAdapter(store, malicious),
    FREE_TIME,
    true,
  );
  assert.equal(result.status, "contract_failed");
  assert.equal(store.snapshot().aiWorld?.continuity?.experiences.length ?? 0, 0);
  assert.equal(store.snapshot().aiWorld?.items?.filter((item) => item.kind === "collection").length ?? 0, 0);
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});
