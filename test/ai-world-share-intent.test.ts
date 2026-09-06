import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldItem, updateAiWorldItem } from "../src/ai-world-items.js";
import { addAiWorldThoughtThread } from "../src/ai-world-continuity.js";
import { persistAiWorldExplorationResult } from "../src/ai-world-exploration-memory.js";
import type { AiWorldExplorationInput } from "../src/ai-world-exploration.js";
import {
  MAX_PENDING_AI_WORLD_SHARE_INTENTS,
  createAiWorldShareIntent,
  listAiWorldShareIntents,
  resolveAiWorldShareIntent,
} from "../src/ai-world-share-intent.js";
import { JsonStore } from "../src/store.js";

const FREE_TIME = "2026-09-05T20:00:00.000Z";

async function createExplorationStore(sourceCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), "our-home-share-intent-"));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, FREE_TIME, "UTC");
  const question = await addAiWorldItem(store, {
    kind: "question",
    title: "为什么有些建筑会让人感觉更安静？",
    note: "想看看公共网页里关于空间、光线和材料的解释。",
    provenance: "authored",
  }, FREE_TIME);
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
    capability: {
      publicWebOnly: true,
      authenticatedSessions: false,
      externalSideEffects: false,
      maxSources: 5,
    },
  };
  const sources = Array.from({ length: sourceCount }, (_, index) => ({
    url: `https://example.org/public-note-${index + 1}`,
    title: `Public note ${index + 1}`,
    summary: `Bounded public summary ${index + 1}.`,
  }));
  const memory = await persistAiWorldExplorationResult(store, input, { status: "completed", sources });
  return { store, filePath, question, memory };
}

test("OH-40/OH-P5: traceable exploration basis creates one bounded AI World maybe-share intent", async () => {
  const { store, memory } = await createExplorationStore();
  const before = store.snapshot();
  const result = await createAiWorldShareIntent(store, {
    basisType: "experience",
    basisId: memory.experience.id,
  }, FREE_TIME);

  assert.equal(result.duplicate, false);
  assert.equal(result.intent.kind, "maybe_share");
  assert.equal(result.intent.world, "AI_WORLD");
  assert.equal(result.intent.provenance, "inferred");
  assert.equal(result.intent.source, "AGENT_LIFE");
  assert.equal(result.intent.status, "pending");
  assert.ok(result.intent.evidenceRefs.some((ref) => ref.startsWith("ai-world-experience:")));
  assert.ok(result.intent.evidenceRefs.some((ref) => ref.startsWith("public-web:")));

  const after = store.snapshot();
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.proactiveQueue, before.proactiveQueue);
  assert.deepEqual(after.phoneDeviceRegistrations, before.phoneDeviceRegistrations);
  assert.deepEqual(after.visualRequests, before.visualRequests);
  assert.deepEqual(after.aiWorld?.continuity?.soulTendencies ?? [], before.aiWorld?.continuity?.soulTendencies ?? []);
  assert.deepEqual(after.aiWorld?.continuity?.soulChanges ?? [], before.aiWorld?.continuity?.soulChanges ?? []);
});

test("OH-40/OH-67/P5.4: same basis is idempotent across retry and restart", async () => {
  const { store, filePath, memory } = await createExplorationStore();
  const first = await createAiWorldShareIntent(store, {
    basisType: "collection",
    basisId: memory.collections[0]!.id,
  }, FREE_TIME);
  const duplicate = await createAiWorldShareIntent(store, {
    basisType: "collection",
    basisId: memory.collections[0]!.id,
  }, FREE_TIME);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.intent.id, first.intent.id);
  assert.equal(listAiWorldShareIntents(store).length, 1);

  const reopened = await JsonStore.open(filePath, false);
  const afterRestart = await createAiWorldShareIntent(reopened, {
    basisType: "collection",
    basisId: memory.collections[0]!.id,
  }, FREE_TIME);
  assert.equal(afterRestart.duplicate, true);
  assert.equal(afterRestart.intent.id, first.intent.id);
  assert.equal(listAiWorldShareIntents(reopened).length, 1);
});

test("OH-40/OH-52/P5.4: creation input has no send/notify/recipient/channel/reasoning escape hatch", async () => {
  const { store, memory } = await createExplorationStore();
  for (const forbidden of [
    { send: true },
    { notify: true },
    { recipient: "user" },
    { channel: "fcm" },
    { action: "send" },
    { reasoning: "hidden" },
    { chainOfThought: "hidden" },
  ]) {
    await assert.rejects(
      () => createAiWorldShareIntent(store, {
        basisType: "experience",
        basisId: memory.experience.id,
        ...forbidden,
      }, FREE_TIME),
      /unrecognized|invalid|expected/i,
    );
  }
  assert.equal(listAiWorldShareIntents(store).length, 0);
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});

test("OH-40/P5.4: missing, archived, or untraceable basis fails closed", async () => {
  const { store, memory } = await createExplorationStore();
  await assert.rejects(
    () => createAiWorldShareIntent(store, { basisType: "collection", basisId: "missing" }, FREE_TIME),
    /active exploration collection/,
  );

  await updateAiWorldItem(store, memory.collections[0]!.id, { status: "archived" }, "2026-09-05T20:00:01.000Z");
  await assert.rejects(
    () => createAiWorldShareIntent(store, { basisType: "collection", basisId: memory.collections[0]!.id }, "2026-09-05T20:00:02.000Z"),
    /active exploration collection/,
  );

  const plainThread = await addAiWorldThoughtThread(store, {
    title: "普通想法",
    summary: "没有 review basis 的 model-generated thread 也不能作为分享候选。",
    provenance: "model_generated",
  }, "2026-09-05T20:00:03.000Z");
  await assert.rejects(
    () => createAiWorldShareIntent(store, { basisType: "thought_thread", basisId: plainThread.id }, "2026-09-05T20:00:04.000Z"),
    /traceable reflection output/,
  );
  assert.equal(listAiWorldShareIntents(store).length, 0);
});

test("OH-40/OH-65/P5.4: pending retention is capped at five and never auto-sends or auto-evicts", async () => {
  const { store, memory } = await createExplorationStore(5);
  assert.equal(memory.collections.length, MAX_PENDING_AI_WORLD_SHARE_INTENTS);
  for (const collection of memory.collections) {
    await createAiWorldShareIntent(store, {
      basisType: "collection",
      basisId: collection.id,
    }, FREE_TIME);
  }
  assert.equal(listAiWorldShareIntents(store, "pending").length, MAX_PENDING_AI_WORLD_SHARE_INTENTS);
  assert.equal(store.snapshot().proactiveQueue.length, 0);

  await assert.rejects(
    () => createAiWorldShareIntent(store, {
      basisType: "experience",
      basisId: memory.experience.id,
    }, FREE_TIME),
    /pending maybe-share limit/,
  );
  assert.equal(listAiWorldShareIntents(store, "pending").length, MAX_PENDING_AI_WORLD_SHARE_INTENTS);
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});

test("OH-40/P5.4: explicit dismiss/consume is terminal and frees one pending slot", async () => {
  const { store, memory } = await createExplorationStore(5);
  const created = [];
  for (const collection of memory.collections) {
    created.push((await createAiWorldShareIntent(store, {
      basisType: "collection",
      basisId: collection.id,
    }, FREE_TIME)).intent);
  }

  const dismissed = await resolveAiWorldShareIntent(
    store,
    created[0]!.id,
    { status: "dismissed" },
    "2026-09-05T20:01:00.000Z",
  );
  assert.equal(dismissed.status, "dismissed");
  assert.equal(listAiWorldShareIntents(store, "pending").length, 4);

  const replacement = await createAiWorldShareIntent(store, {
    basisType: "experience",
    basisId: memory.experience.id,
  }, "2026-09-05T20:02:00.000Z");
  assert.equal(replacement.intent.status, "pending");
  assert.equal(listAiWorldShareIntents(store, "pending").length, 5);

  await assert.rejects(
    () => resolveAiWorldShareIntent(store, dismissed.id, { status: "consumed" }, "2026-09-05T20:03:00.000Z"),
    /cannot change terminal status/,
  );
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});
