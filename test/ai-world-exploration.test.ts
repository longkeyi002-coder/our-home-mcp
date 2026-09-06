import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldItem } from "../src/ai-world-items.js";
import {
  EXPLORATION_FAILURE_BACKOFF_MS,
  EXPLORATION_MAX_ATTEMPTS_PER_UTC_DAY,
  EXPLORATION_SUCCESS_COOLDOWN_MS,
  getAiWorldExplorationRuntimeState,
  runAiWorldExplorationCycle,
  type AiWorldExplorationAdapter,
} from "../src/ai-world-exploration.js";
import { JsonStore } from "../src/store.js";

const FREE_TIME = "2026-09-05T18:00:00.000Z";

async function createStore(at = FREE_TIME) {
  const directory = await mkdtemp(join(tmpdir(), "our-home-exploration-"));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, at, "UTC");
  return { store, filePath };
}

async function addQuestion(store: JsonStore, at = FREE_TIME) {
  return addAiWorldItem(store, {
    kind: "question",
    title: "为什么有些建筑会让人感觉更安静？",
    note: "想看看公共网页里关于空间、光线和材料的解释。",
    provenance: "authored",
  }, at);
}

const successfulAdapter = (calls: unknown[]): AiWorldExplorationAdapter => ({
  async explore(input) {
    calls.push(structuredClone(input));
    return {
      status: "completed",
      sources: [{
        url: "https://example.org/public-architecture-note",
        title: "Public architecture note",
        summary: "A bounded public-web summary about spatial calm.",
      }],
    };
  },
});

test("OH-50/OH-65/P5.1: disabled or topic-less exploration makes zero provider calls", async () => {
  const { store } = await createStore();
  const calls: unknown[] = [];
  const adapter = successfulAdapter(calls);

  assert.deepEqual(await runAiWorldExplorationCycle(store, adapter, FREE_TIME, false), {
    status: "disabled",
    attempted: false,
  });
  assert.deepEqual(await runAiWorldExplorationCycle(store, adapter, FREE_TIME, true), {
    status: "no_topic",
    attempted: false,
  });
  assert.equal(calls.length, 0);
});

test("OH-20/OH-50/P5.1: exploration is eligible only during current AI World free time", async () => {
  const focusedAt = "2026-09-05T10:00:00.000Z";
  const { store } = await createStore(focusedAt);
  await addQuestion(store, focusedAt);
  const calls: unknown[] = [];

  const result = await runAiWorldExplorationCycle(store, successfulAdapter(calls), focusedAt, true);
  assert.equal(result.status, "not_free_time");
  assert.equal(result.attempted, false);
  assert.equal(calls.length, 0);
});

test("OH-20/OH-64/P5.1: stale persisted free-time state cannot authorize later-night exploration", async () => {
  const { store } = await createStore();
  await addQuestion(store);
  const calls: unknown[] = [];

  // The store still physically contains the 18:00 free-time phase here. The exploration gate
  // must derive the deterministic phase at 22:00 instead of trusting that stale snapshot.
  assert.equal(store.snapshot().aiWorld?.state.currentActivity, "free_time");
  const result = await runAiWorldExplorationCycle(
    store,
    successfulAdapter(calls),
    "2026-09-05T22:00:00.000Z",
    true,
  );
  assert.equal(result.status, "not_free_time");
  assert.equal(result.attempted, false);
  assert.equal(calls.length, 0);
  // Pure eligibility derivation must not silently advance the persisted world itself.
  assert.equal(store.snapshot().aiWorld?.state.currentActivity, "free_time");
});

test("OH-30/OH-50/P5.1: Runtime binds one AI World topic and supplies no Earth Life context", async () => {
  const { store } = await createStore();
  const question = await addQuestion(store);
  await store.recordObservation({
    kind: "manual_status",
    label: "private earth marker",
    value: "this must not enter exploration input",
    observedAt: FREE_TIME,
    source: "user",
    confidence: "declared",
  });

  const calls: any[] = [];
  const result = await runAiWorldExplorationCycle(store, successfulAdapter(calls), FREE_TIME, true);
  assert.equal(result.status, "completed");
  assert.equal(result.attempted, true);
  assert.equal(result.topic?.sourceId, question.id);
  assert.equal(result.topic?.sourceKind, "question");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].topic.sourceId, question.id);
  assert.deepEqual(calls[0].capability, {
    publicWebOnly: true,
    authenticatedSessions: false,
    externalSideEffects: false,
    maxSources: 5,
  });
  const serialized = JSON.stringify(calls[0]);
  assert.doesNotMatch(serialized, /private earth marker|this must not enter exploration input/);
  assert.doesNotMatch(serialized, /observations|proactiveQueue|phoneDeviceRegistrations/);

  const after = store.snapshot();
  assert.equal(after.aiWorld?.items?.length, 1);
  assert.equal(after.aiWorld?.continuity?.notes.length ?? 0, 0);
  assert.equal(after.proactiveQueue.length, 0);
});

test("OH-50/OH-52/P5.1: strict result contract rejects attempted side-effect or hidden-reasoning fields", async () => {
  const { store } = await createStore();
  await addQuestion(store);
  let calls = 0;
  const malicious: AiWorldExplorationAdapter = {
    async explore() {
      calls += 1;
      return {
        status: "completed",
        sources: [{
          url: "https://example.org/article",
          title: "Article",
          summary: "Public summary",
        }],
        action: "purchase",
        chainOfThought: "hidden reasoning",
      };
    },
  };

  const failed = await runAiWorldExplorationCycle(store, malicious, FREE_TIME, true);
  assert.equal(failed.status, "contract_failed");
  assert.equal(failed.attempted, true);
  assert.equal(calls, 1);
  assert.equal(store.snapshot().proactiveQueue.length, 0);

  const tooSoon = new Date(Date.parse(FREE_TIME) + EXPLORATION_FAILURE_BACKOFF_MS - 1).toISOString();
  const backedOff = await runAiWorldExplorationCycle(store, malicious, tooSoon, true);
  assert.equal(backedOff.status, "backoff");
  assert.equal(backedOff.attempted, false);
  assert.equal(calls, 1);
});

test("OH-64/OH-65/OH-67/P5.1: provider failure backoff and daily budget survive restart", async () => {
  const { store, filePath } = await createStore();
  await addQuestion(store);
  let calls = 0;
  const failing: AiWorldExplorationAdapter = {
    async explore() {
      calls += 1;
      throw new Error("provider unavailable");
    },
  };

  const first = await runAiWorldExplorationCycle(store, failing, FREE_TIME, true);
  assert.equal(first.status, "provider_failed");
  assert.equal(calls, 1);

  const reopened = await JsonStore.open(filePath, false);
  const beforeRetry = new Date(Date.parse(FREE_TIME) + EXPLORATION_FAILURE_BACKOFF_MS - 1).toISOString();
  assert.equal((await runAiWorldExplorationCycle(reopened, failing, beforeRetry, true)).status, "backoff");
  assert.equal(calls, 1);

  const retryAt = new Date(Date.parse(FREE_TIME) + EXPLORATION_FAILURE_BACKOFF_MS).toISOString();
  assert.equal((await runAiWorldExplorationCycle(reopened, failing, retryAt, true)).status, "provider_failed");
  assert.equal(calls, 2);
  assert.equal(getAiWorldExplorationRuntimeState(reopened).attemptsToday, EXPLORATION_MAX_ATTEMPTS_PER_UTC_DAY);

  const afterSecondBackoff = new Date(Date.parse(retryAt) + EXPLORATION_FAILURE_BACKOFF_MS).toISOString();
  const budgeted = await runAiWorldExplorationCycle(reopened, failing, afterSecondBackoff, true);
  assert.equal(budgeted.status, "daily_budget");
  assert.equal(budgeted.attempted, false);
  assert.equal(calls, 2);
});

test("OH-64/OH-65/P5.1: successful exploration cooldown persists without overriding the free-time gate", async () => {
  const { store, filePath } = await createStore();
  await addQuestion(store);
  const calls: unknown[] = [];
  const adapter = successfulAdapter(calls);

  assert.equal(EXPLORATION_SUCCESS_COOLDOWN_MS, 6 * 60 * 60_000);
  assert.equal((await runAiWorldExplorationCycle(store, adapter, FREE_TIME, true)).status, "completed");
  assert.equal(calls.length, 1);

  const threeHoursLater = new Date(Date.parse(FREE_TIME) + 3 * 60 * 60_000).toISOString();
  assert.equal((await runAiWorldExplorationCycle(store, adapter, threeHoursLater, true)).status, "cooldown");
  assert.equal(calls.length, 1);

  // Six hours later the cost cooldown is over, but midnight is not free time and therefore still
  // cannot authorize an exploration call.
  const exactCooldown = new Date(Date.parse(FREE_TIME) + EXPLORATION_SUCCESS_COOLDOWN_MS).toISOString();
  assert.equal((await runAiWorldExplorationCycle(store, adapter, exactCooldown, true)).status, "not_free_time");
  assert.equal(calls.length, 1);

  const reopened = await JsonStore.open(filePath, false);
  const nextFreeTime = "2026-09-06T18:00:00.000Z";
  assert.equal((await runAiWorldExplorationCycle(reopened, adapter, nextFreeTime, true)).status, "completed");
  assert.equal(calls.length, 2);
});
