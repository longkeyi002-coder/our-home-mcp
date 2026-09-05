import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldExperience, readAiWorldContinuity } from "../src/ai-world-continuity.js";
import type { AiWorldReflectionAdapter, AiWorldReflectionInput } from "../src/ai-world-reflection.js";
import { quietHoursPolicyFromEnv } from "../src/quiet-hours.js";
import { JsonStore } from "../src/store.js";
import { NoopNotifier, runProactiveCycle } from "../src/worker.js";

const START = "2026-09-05T10:00:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  await addAiWorldExperience(store, {
    summary: "到期后才允许进入反思 gate",
    occurredAt: START,
    provenance: "authored",
    nextReviewAt: START,
  }, START);
  return store;
}

class CountingReflectionAdapter implements AiWorldReflectionAdapter {
  calls: AiWorldReflectionInput[] = [];
  constructor(private readonly result: unknown) {}
  async evaluate(input: AiWorldReflectionInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    return this.result;
  }
}

test("OH-64/OH-P4: Runtime cycle does not reflect when no reflection engine is supplied", async () => {
  const store = await initializedStore("our-home-reflection-worker-off-");
  const before = readAiWorldContinuity(store).experiences[0]?.nextReviewAt;

  await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(START),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
  );

  assert.equal(readAiWorldContinuity(store).experiences[0]?.nextReviewAt, before);
});

test("OH-20/OH-64/OH-P4: Runtime invokes at most one explicit reflection adapter and keeps it separate from Care", async () => {
  const store = await initializedStore("our-home-reflection-worker-on-");
  const adapter = new CountingReflectionAdapter({ action: "ignore" });
  const queueBefore = store.snapshot().proactiveQueue;

  const result = await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(START),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    adapter,
  );

  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.source.recordType, "experience");
  assert.equal(result.deliveredCount, 0);
  assert.deepEqual(store.snapshot().proactiveQueue, queueBefore);
});

test("OH-67/OH-P4: reflection provider failure cannot block the Earth Life worker cycle", async () => {
  const store = await initializedStore("our-home-reflection-worker-failure-");
  const adapter = new CountingReflectionAdapter({
    action: "proactive_message",
    candidate: { title: "forbidden", message: "forbidden", reason: "forbidden" },
  });
  const heartbeatsBefore = store.snapshot().heartbeats.length;

  const result = await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(START),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    adapter,
  );

  assert.equal(adapter.calls.length, 1);
  assert.ok(store.snapshot().heartbeats.length > heartbeatsBefore);
  assert.equal(result.failedCount, 0);
  assert.equal(readAiWorldContinuity(store).experiences[0]?.nextReviewAt, START);
  assert.equal(store.snapshot().proactiveQueue.length, 0);
});
