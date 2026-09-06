import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { quietHoursPolicyFromEnv } from "../src/quiet-hours.js";
import { recordRelationshipFeedback } from "../src/relationship-feedback.js";
import {
  listRelationshipReplyContent,
  listRelationshipReplyProposals,
  recordRelationshipReplyContent,
  type RelationshipReplyReviewAdapter,
  type RelationshipReplyReviewInput,
} from "../src/relationship-reply-review.js";
import { JsonStore } from "../src/store.js";
import { runProactiveCycle, type ProactiveNotifier } from "../src/worker.js";
import type { ProactiveCandidate } from "../src/types.js";

const WORLD_AT = "2026-09-05T09:00:00.000Z";
const DELIVERED_AT = "2026-09-05T10:00:00.000Z";
const REPLY_AT = "2026-09-05T10:05:00.000Z";
const CYCLE_AT = "2026-09-05T10:10:00.000Z";

class CountingReplyReviewAdapter implements RelationshipReplyReviewAdapter {
  calls: RelationshipReplyReviewInput[] = [];
  constructor(private readonly result: unknown, private readonly shouldThrow = false) {}
  async evaluate(input: RelationshipReplyReviewInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    if (this.shouldThrow) throw new Error("reply review provider down");
    return this.result;
  }
}

class RecordingNotifier implements ProactiveNotifier {
  delivered: string[] = [];
  async deliver(candidate: ProactiveCandidate): Promise<void> {
    this.delivered.push(candidate.id);
  }
}

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, WORLD_AT, "UTC");
  await store.update((data) => {
    data.proactiveQueue.unshift({
      id: "delivered-subject",
      title: "A question",
      message: "Would you like reminders like this?",
      reason: "reply review subject",
      dueAt: DELIVERED_AT,
      status: "delivered",
      createdAt: WORLD_AT,
      deliveredAt: DELIVERED_AT,
      attempts: 1,
      source: "AGENT_LIFE",
    });
  });
  const reply = await recordRelationshipFeedback(store, {
    signalKey: "chat:reply:delivered-subject",
    proactiveCandidateId: "delivered-subject",
    signal: "reply",
    occurredAt: REPLY_AT,
  }, REPLY_AT);
  await recordRelationshipReplyContent(store, {
    relationshipFeedbackId: reply.record.id,
    text: "少一点普通提醒就好。",
  }, REPLY_AT);
  return store;
}

test("OH-64/OH-P6: Runtime makes zero reply-review calls when no adapter is supplied", async () => {
  const store = await initializedStore("our-home-reply-worker-off-");
  const before = structuredClone(listRelationshipReplyContent(store));
  const notifier = new RecordingNotifier();

  await runProactiveCycle(
    store,
    notifier,
    new Date(CYCLE_AT),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
  );

  assert.deepEqual(listRelationshipReplyContent(store), before);
  assert.equal(listRelationshipReplyProposals(store).length, 0);
});

test("OH-64/OH-P6: Runtime invokes at most one explicit reply-review adapter in the single Life Loop", async () => {
  const store = await initializedStore("our-home-reply-worker-on-");
  const adapter = new CountingReplyReviewAdapter({ action: "ignore" });
  const notifier = new RecordingNotifier();

  await runProactiveCycle(
    store,
    notifier,
    new Date(CYCLE_AT),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    undefined,
    undefined,
    adapter,
  );

  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.proactiveMessage.id, "delivered-subject");
  assert.equal(listRelationshipReplyContent(store)[0]?.reviewOutcome, "ignored");
  assert.equal(listRelationshipReplyProposals(store).length, 0);
});

test("OH-67/OH-P6: reply-review provider failure cannot block heartbeat or existing Care delivery", async () => {
  const store = await initializedStore("our-home-reply-worker-failure-");
  await store.update((data) => {
    data.proactiveQueue.unshift({
      id: "care-message",
      title: "Care",
      message: "Existing Care must still deliver.",
      reason: "worker isolation test",
      dueAt: CYCLE_AT,
      status: "pending",
      createdAt: WORLD_AT,
      attempts: 0,
      source: "AGENT_LIFE",
    });
  });
  const adapter = new CountingReplyReviewAdapter(undefined, true);
  const notifier = new RecordingNotifier();
  const heartbeatsBefore = store.snapshot().heartbeats.length;

  const result = await runProactiveCycle(
    store,
    notifier,
    new Date(CYCLE_AT),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
    undefined,
    undefined,
    adapter,
  );

  assert.equal(adapter.calls.length, 1);
  assert.ok(store.snapshot().heartbeats.length > heartbeatsBefore);
  assert.equal(result.deliveredCount, 1);
  assert.deepEqual(notifier.delivered, ["care-message"]);
  assert.equal(store.snapshot().proactiveQueue.find((item) => item.id === "care-message")?.status, "delivered");
  assert.equal(listRelationshipReplyContent(store)[0]?.reviewedAt, undefined);
  assert.equal(listRelationshipReplyProposals(store).length, 0);
});
