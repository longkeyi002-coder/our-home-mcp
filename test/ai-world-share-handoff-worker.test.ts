import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldExperience, addAiWorldThoughtThread, readAiWorldContinuity } from "../src/ai-world-continuity.js";
import type { AiWorldReflectionAdapter, AiWorldReflectionInput } from "../src/ai-world-reflection.js";
import {
  MAX_PENDING_AI_WORLD_SHARE_INTENTS,
  createAiWorldShareIntent,
  listAiWorldShareIntents,
} from "../src/ai-world-share-intent.js";
import { quietHoursPolicyFromEnv } from "../src/quiet-hours.js";
import { JsonStore } from "../src/store.js";
import { NoopNotifier, runProactiveCycle } from "../src/worker.js";

const DUE = "2026-09-05T10:00:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, DUE, "UTC");
  return store;
}

async function dueExperience(store: JsonStore, summary = "A due AI World experience") {
  return addAiWorldExperience(store, {
    summary,
    occurredAt: DUE,
    provenance: "authored",
    nextReviewAt: DUE,
  }, DUE);
}

class CountingReflectionAdapter implements AiWorldReflectionAdapter {
  calls: AiWorldReflectionInput[] = [];
  constructor(private readonly result: unknown) {}
  async evaluate(input: AiWorldReflectionInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    return this.result;
  }
}

test("OH-40/OH-P5: recorded reflection creates one internal maybe-share intent without Earth delivery", async () => {
  const store = await initializedStore("our-home-share-handoff-recorded-");
  await dueExperience(store);
  const adapter = new CountingReflectionAdapter({
    action: "record_reflection",
    reflection: {
      title: "A thought worth keeping",
      summary: "A bounded reusable reflection that may be worth sharing later.",
    },
  });
  const before = store.snapshot();
  const soulBefore = readAiWorldContinuity(store).soulTendencies ?? [];

  const result = await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(DUE),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    adapter,
  );

  assert.equal(adapter.calls.length, 1);
  const intents = listAiWorldShareIntents(store, "pending");
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.basisType, "thought_thread");
  assert.equal(intents[0]?.status, "pending");
  assert.equal(result.deliveredCount, 0);
  assert.deepEqual(store.snapshot().proactiveQueue, before.proactiveQueue);
  assert.deepEqual(store.snapshot().observations, before.observations);
  assert.deepEqual(readAiWorldContinuity(store).soulTendencies ?? [], soulBefore);
});

test("OH-40/OH-67/OH-P5: reconciled reflection also restores the exact idempotent maybe-share handoff without another model call", async () => {
  const store = await initializedStore("our-home-share-handoff-reconcile-");
  const experience = await dueExperience(store, "Crash-recovery source");
  const existingThread = await addAiWorldThoughtThread(store, {
    title: "Already persisted reflection",
    summary: "The reflection content survived before source reschedule completed.",
    provenance: "model_generated",
    evidenceRefs: [`ai-world-review:experience:${experience.id}:${DUE}`],
  }, DUE);
  const adapter = new CountingReflectionAdapter({ action: "ignore" });

  await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(DUE),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    adapter,
  );

  assert.equal(adapter.calls.length, 0);
  const intents = listAiWorldShareIntents(store, "pending");
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.basisId, existingThread.id);
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});

test("OH-40/OH-P5: ignored or failed reflection creates no maybe-share intent", async () => {
  const ignoredStore = await initializedStore("our-home-share-handoff-ignore-");
  await dueExperience(ignoredStore);
  const ignored = new CountingReflectionAdapter({ action: "ignore" });
  await runProactiveCycle(
    ignoredStore,
    new NoopNotifier(),
    new Date(DUE),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    ignored,
  );
  assert.equal(listAiWorldShareIntents(ignoredStore).length, 0);

  const failedStore = await initializedStore("our-home-share-handoff-failed-");
  await dueExperience(failedStore);
  const failed = new CountingReflectionAdapter({
    action: "proactive_message",
    candidate: { title: "forbidden", message: "forbidden", reason: "forbidden" },
  });
  const heartbeatsBefore = failedStore.snapshot().heartbeats.length;
  await runProactiveCycle(
    failedStore,
    new NoopNotifier(),
    new Date(DUE),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    failed,
  );
  assert.equal(listAiWorldShareIntents(failedStore).length, 0);
  assert.ok(failedStore.snapshot().heartbeats.length > heartbeatsBefore);
  assert.equal(failedStore.snapshot().proactiveQueue.length, 0);
});

test("OH-40/OH-65/OH-67/OH-P5: full maybe-share capacity cannot block Earth heartbeat when a new reflection matures", async () => {
  const store = await initializedStore("our-home-share-handoff-capacity-");
  for (let index = 0; index < MAX_PENDING_AI_WORLD_SHARE_INTENTS; index += 1) {
    const thread = await addAiWorldThoughtThread(store, {
      title: `seed reflection ${index}`,
      summary: `seed reflection summary ${index}`,
      provenance: "model_generated",
      evidenceRefs: [`ai-world-review:seed:${index}:${DUE}`],
    }, DUE);
    await createAiWorldShareIntent(store, {
      basisType: "thought_thread",
      basisId: thread.id,
    }, DUE);
  }
  assert.equal(listAiWorldShareIntents(store, "pending").length, MAX_PENDING_AI_WORLD_SHARE_INTENTS);

  await dueExperience(store, "A sixth reflection source");
  const adapter = new CountingReflectionAdapter({
    action: "record_reflection",
    reflection: {
      title: "Sixth reflection",
      summary: "This reflection is valid but the pending maybe-share queue is intentionally full.",
    },
  });
  const heartbeatsBefore = store.snapshot().heartbeats.length;
  const queueBefore = structuredClone(store.snapshot().proactiveQueue);

  await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(DUE),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    adapter,
  );

  assert.equal(adapter.calls.length, 1);
  assert.equal(listAiWorldShareIntents(store, "pending").length, MAX_PENDING_AI_WORLD_SHARE_INTENTS);
  assert.ok(store.snapshot().heartbeats.length > heartbeatsBefore);
  assert.deepEqual(store.snapshot().proactiveQueue, queueBefore);
});
