import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldItem } from "../src/ai-world-items.js";
import {
  EXPLORATION_REVIEW_DELAY_MS,
  PersistingAiWorldExplorationAdapter,
} from "../src/ai-world-exploration-memory.js";
import type {
  AiWorldExplorationAdapter,
  AiWorldExplorationInput,
} from "../src/ai-world-exploration.js";
import {
  aiWorldExplorationConfigFromEnv,
  selectAiWorldExplorationAdapter,
} from "../src/ai-world-exploration-runtime.js";
import { quietHoursPolicyFromEnv } from "../src/quiet-hours.js";
import { JsonStore } from "../src/store.js";
import { runProactiveCycle, type ProactiveNotifier } from "../src/worker.js";

const FREE_TIME = "2026-09-05T20:00:00.000Z";

async function createStore(at = FREE_TIME) {
  const directory = await mkdtemp(join(tmpdir(), "our-home-exploration-worker-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, at, "UTC");
  return store;
}

async function addQuestion(store: JsonStore, at = FREE_TIME) {
  return addAiWorldItem(store, {
    kind: "question",
    title: "为什么有些建筑让人觉得安静？",
    provenance: "authored",
  }, at);
}

class CountingExplorationAdapter implements AiWorldExplorationAdapter {
  calls: AiWorldExplorationInput[] = [];
  constructor(private readonly mode: "success" | "fail" = "success") {}

  async explore(input: AiWorldExplorationInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    if (this.mode === "fail") throw new Error("search provider unavailable");
    return {
      status: "completed",
      sources: [{
        url: "https://example.org/public-note",
        title: "Public note",
        summary: "A bounded public-web summary.",
      }],
    };
  }
}

const noopNotifier: ProactiveNotifier = {
  async deliver() {
    throw new Error("no delivery expected");
  },
};

test("OH-64/OH-65/OH-P5: default runtime exploration configuration is disabled and constructs no provider", async () => {
  const store = await createStore();
  const config = aiWorldExplorationConfigFromEnv({});
  assert.deepEqual(config, { enabled: false, searchUrl: undefined });
  assert.equal(selectAiWorldExplorationAdapter(store, config), undefined);
});

test("OH-67/OH-P5: enabling exploration without a search URL fails closed at startup selection", async () => {
  const store = await createStore();
  assert.throws(
    () => selectAiWorldExplorationAdapter(store, { enabled: true }),
    /OUR_HOME_EXPLORATION_SEARCH_URL is required/,
  );
});

test("OH-20/OH-64/OH-P5: one Life Loop cycle can explore in free time and hand the Experience to P4 review 12 hours later", async () => {
  const store = await createStore();
  const question = await addQuestion(store);
  const inner = new CountingExplorationAdapter();
  const adapter = new PersistingAiWorldExplorationAdapter(store, inner);

  const result = await runProactiveCycle(
    store,
    noopNotifier,
    new Date(FREE_TIME),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    undefined,
    adapter,
  );

  assert.equal(inner.calls.length, 1);
  assert.equal(inner.calls[0]?.topic.sourceId, question.id);
  assert.equal(result.failedCount, 0);
  const experience = store.snapshot().aiWorld?.continuity?.experiences[0];
  assert.ok(experience);
  assert.equal(
    experience.nextReviewAt,
    new Date(Date.parse(FREE_TIME) + EXPLORATION_REVIEW_DELAY_MS).toISOString(),
  );
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});

test("OH-20/OH-65/OH-P5: stale/non-free-time phase makes zero exploration calls inside the Life Loop", async () => {
  const focusedAt = "2026-09-05T10:00:00.000Z";
  const store = await createStore(focusedAt);
  await addQuestion(store, focusedAt);
  const adapter = new CountingExplorationAdapter();

  await runProactiveCycle(
    store,
    noopNotifier,
    new Date(focusedAt),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    undefined,
    adapter,
  );

  assert.equal(adapter.calls.length, 0);
});

test("OH-67/OH-P5: exploration provider failure cannot block Earth heartbeat or a due proactive delivery", async () => {
  const store = await createStore();
  await addQuestion(store);
  await store.scheduleProactiveMessage({
    title: "still deliver",
    message: "exploration failure must not block Care",
    reason: "isolation regression",
    dueAt: FREE_TIME,
  });
  const exploration = new CountingExplorationAdapter("fail");
  let deliveryAttempts = 0;
  const notifier: ProactiveNotifier = {
    async deliver() {
      deliveryAttempts += 1;
    },
  };
  const heartbeatsBefore = store.snapshot().heartbeats.length;

  const result = await runProactiveCycle(
    store,
    notifier,
    new Date(FREE_TIME),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    undefined,
    exploration,
  );

  assert.equal(exploration.calls.length, 1);
  assert.equal(deliveryAttempts, 1);
  assert.equal(result.deliveredCount, 1);
  assert.ok(store.snapshot().heartbeats.length > heartbeatsBefore);
});
