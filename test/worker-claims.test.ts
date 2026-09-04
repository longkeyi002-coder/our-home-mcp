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

test("wake event processing claim prevents a second cycle from claiming the same event", async () => {
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

  const first = await claimPendingWakeEvents(store, "2026-09-05T00:03:00.000Z", 5);
  const second = await claimPendingWakeEvents(store, "2026-09-05T00:03:01.000Z", 5);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.ok(store.snapshot().wakeEvents[0]?.processingAt);

  await releaseWakeEventClaim(store, first[0]!.id);
  const third = await claimPendingWakeEvents(store, "2026-09-05T00:03:02.000Z", 5);
  assert.equal(third.length, 1);
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

test("failed proactive delivery is exponentially backed off before it can be claimed again", async () => {
  const store = await createStore();
  const candidate = await store.scheduleProactiveMessage({
    title: "test",
    message: "test",
    reason: "test",
    dueAt: "2026-09-05T00:00:00.000Z",
  });
  await store.recordProactiveAttempt(candidate.id, "FCM unavailable");

  const tooEarly = await claimDueProactiveMessages(store, "2026-09-05T00:00:20.000Z");
  assert.equal(tooEarly.length, 0);

  // recordProactiveAttempt uses the real current timestamp, so set deterministic attempt state for this assertion.
  await store.update((data) => {
    const item = data.proactiveQueue.find((value) => value.id === candidate.id)!;
    item.attempts = 1;
    item.lastAttemptAt = "2026-09-05T00:00:00.000Z";
    item.processingAt = undefined;
  });
  assert.equal(proactiveRetryDelayMs(1), 30_000);
  assert.equal((await claimDueProactiveMessages(store, "2026-09-05T00:00:29.999Z")).length, 0);
  assert.deepEqual(
    (await claimDueProactiveMessages(store, "2026-09-05T00:00:30.000Z")).map((item) => item.id),
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
