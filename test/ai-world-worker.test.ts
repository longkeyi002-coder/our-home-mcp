import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPersistedAiWorld } from "../src/ai-world-store.js";
import { JsonStore } from "../src/store.js";
import { runProactiveCycle } from "../src/worker.js";

test("OH-67/OH-P3: Runtime cycle advances AI World without any Brain adapter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-world-worker-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);

  await runProactiveCycle(
    store,
    { deliver: async () => {} },
    new Date("2026-09-05T10:00:00.000Z"),
    undefined,
    undefined,
    "UTC",
  );
  let aiWorld = readPersistedAiWorld(store, "2026-09-05T10:30:00.000Z");
  assert.equal(aiWorld?.state.currentActivity, "focused_work");
  assert.equal(aiWorld?.recentHistory.length, 1);

  await runProactiveCycle(
    store,
    { deliver: async () => {} },
    new Date("2026-09-05T12:00:00.000Z"),
    undefined,
    undefined,
    "UTC",
  );
  aiWorld = readPersistedAiWorld(store, "2026-09-05T12:00:00.000Z");
  assert.equal(aiWorld?.state.currentActivity, "midday_break");
  assert.equal(aiWorld?.recentHistory.length, 2);
});

test("OH-67: corrupted AI World is isolated and does not block Earth proactive delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-world-isolation-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await runProactiveCycle(
    store,
    { deliver: async () => {} },
    new Date("2026-09-05T10:00:00.000Z"),
    undefined,
    undefined,
    "UTC",
  );
  await store.update((data) => {
    if (!data.aiWorld) throw new Error("missing test AI World");
    (data.aiWorld.state as { world: string }).world = "EARTH";
  });
  const candidate = await store.scheduleProactiveMessage({
    title: "Earth delivery survives",
    message: "AI World failure must not block this message.",
    reason: "failure isolation test",
    dueAt: "2026-09-05T10:01:00.000Z",
  });
  const delivered: string[] = [];

  const result = await runProactiveCycle(
    store,
    { deliver: async (item) => { delivered.push(item.id); } },
    new Date("2026-09-05T10:02:00.000Z"),
    undefined,
    undefined,
    "UTC",
  );

  assert.equal(result.deliveredCount, 1);
  assert.deepEqual(delivered, [candidate.id]);
  assert.equal(store.snapshot().proactiveQueue.find((item) => item.id === candidate.id)?.status, "delivered");
});
