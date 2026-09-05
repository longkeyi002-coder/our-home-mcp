import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import {
  claimDueProactiveMessages,
  claimPendingWakeEvents,
  proactiveRetryDelayMs,
  recoverInterruptedWorkerClaims,
  releaseProactiveClaim,
  releaseWakeEventClaim,
} from "../src/worker-claims.js";

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-worker-claims-"));
  return JsonStore.open(join(dir, "our-home.json"), false);
}

async function createWakeEventStore() {
  const store = await createStore();
  await store.evaluateWakeEvents("2026-09-05T00:00:00.000Z");
  await store.recordObservation({
    kind: "screen_app",
    label: "foreground",
    value: "com.example.app",
    observedAt: "2026-09-05T00:01:00.000Z",
    source: "phone",
    confidence: "observed",
  });
  await store.evaluateWakeEvents("2026-09-05T00:02:00.000Z");
  return store;
}

test("wake event processing claim prevents a second cycle from claiming the same event", async () => {
  const store = await createWakeEventStore();
  const first = await claimPendingWakeEvents(store, "2026-09-05T00:03:00.000Z", 5);
  const second = await claimPendingWakeEvents(store, "2026-09-05T00:03:01.000Z", 5);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.ok(store.snapshot().wakeEvents[0]?.processingAt);

  await releaseWakeEventClaim(store, first[0]!.id);
  const third = await claimPendingWakeEvents(store, "2026-09-05T00:03:02.000Z", 5);
  assert.equal(third.length, 1);
});

test("wake claim acts as a five minute brain failure cooldown when it is not released", async () => {
  const store = await createWakeEventStore();
  const first = await claimPendingWakeEvents(store, "2026-09-05T00:03:00.000Z", 5);
  assert.equal(first.length, 1);

  assert.equal((await claimPendingWakeEvents(store, "2026-09-05T00:07:59.999Z", 5)).length, 0);
  assert.deepEqual(
    (await claimPendingWakeEvents(store, "2026-09-05T00:08:00.000Z", 5)).map((item) => item.id),
    [first[0]!.id],
  );
});

test("proactive candidate claim is durable and explicitly releasable", async () => {
  const store = await createStore();
  const candidate = await store.scheduleProactiveMessage({
    title: "test",
    message: "test",
    reason: "test",
    dueAt: "2026-09-05T00:00:00.000Z",
  });
  const first = await claimDueProactiveMessages(store, "2026-09-05T00:01:00.000Z");
  const second = await claimDueProactiveMessages(store, "2026-09-05T00:01:01.000Z");
  assert.deepEqual(first.map((item) => item.id), [candidate.id]);
  assert.equal(second.length, 0);

  await releaseProactiveClaim(store, candidate.id);
  const third = await claimDueProactiveMessages(store, "2026-09-05T00:01:02.000Z");
  assert.deepEqual(third.map((item) => item.id), [candidate.id]);
});

test("failed proactive delivery retry stays on the Runtime cycle clock", async () => {
  const store = await createStore();
  const candidate = await store.scheduleProactiveMessage({
    title: "test",
    message: "test",
    reason: "test",
    dueAt: "2026-09-05T00:00:00.000Z",
  });
  const attemptedAt = "2026-09-05T00:01:00.000Z";

  const first = await claimDueProactiveMessages(store, attemptedAt);
  assert.deepEqual(first.map((item) => item.id), [candidate.id]);

  // recordProactiveAttempt is also used by older direct callers and therefore still stamps
  // wall-clock now(). The Worker claim owns the deterministic cycle timestamp, so releasing
  // that claim must normalize lastAttemptAt back to processingAt before retry policy reads it.
  await store.recordProactiveAttempt(candidate.id, "temporary failure");
  await releaseProactiveClaim(store, candidate.id);

  const persisted = store.snapshot().proactiveQueue.find((item) => item.id === candidate.id)!;
  assert.equal(persisted.lastAttemptAt, attemptedAt);
  assert.equal(persisted.processingAt, undefined);
  assert.equal(persisted.attempts, 1);
  assert.equal(proactiveRetryDelayMs(1), 30_000);
  assert.equal((await claimDueProactiveMessages(store, "2026-09-05T00:01:29.999Z")).length, 0);
  assert.deepEqual(
    (await claimDueProactiveMessages(store, "2026-09-05T00:01:30.000Z")).map((item) => item.id),
    [candidate.id],
  );
});

test("proactive retry delay is bounded", () => {
  assert.equal(proactiveRetryDelayMs(0), 0);
  assert.equal(proactiveRetryDelayMs(1), 30_000);
  assert.equal(proactiveRetryDelayMs(2), 60_000);
  assert.equal(proactiveRetryDelayMs(20), 30 * 60_000);
});

test("single owner restart clears orphaned processing claims", async () => {
  const store = await createStore();
  const candidate = await store.scheduleProactiveMessage({
    title: "test",
    message: "test",
    reason: "test",
    dueAt: "2026-09-05T00:00:00.000Z",
  });
  await claimDueProactiveMessages(store, "2026-09-05T00:01:00.000Z");
  assert.ok(store.snapshot().proactiveQueue.find((item) => item.id === candidate.id)?.processingAt);

  await recoverInterruptedWorkerClaims(store);
  assert.equal(store.snapshot().proactiveQueue.find((item) => item.id === candidate.id)?.processingAt, undefined);
});
