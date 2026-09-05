import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { readAiWorldContinuity } from "../src/ai-world-continuity.js";
import { listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import {
  listRelationshipFeedback,
  recordRelationshipFeedback,
} from "../src/relationship-feedback.js";
import {
  RELATIONSHIP_REPLY_FAILURE_BACKOFF_MS,
  RELATIONSHIP_REPLY_SUCCESS_COOLDOWN_MS,
  listRelationshipReplyContent,
  listRelationshipReplyProposals,
  readRelationshipReplyReviewRuntimeState,
  recordRelationshipReplyContent,
  runRelationshipReplyReviewCycle,
  type RelationshipReplyReviewAdapter,
  type RelationshipReplyReviewInput,
} from "../src/relationship-reply-review.js";
import { JsonStore } from "../src/store.js";
import { listUserFeedback } from "../src/user-feedback.js";

const WORLD_AT = "2026-09-05T09:00:00.000Z";
const DELIVERED_AT = "2026-09-05T10:00:00.000Z";
const REPLY_AT = "2026-09-05T10:05:00.000Z";
const REVIEW_AT = "2026-09-05T10:10:00.000Z";

class MockReplyReviewAdapter implements RelationshipReplyReviewAdapter {
  calls: RelationshipReplyReviewInput[] = [];
  constructor(private readonly output: unknown) {}

  async evaluate(input: RelationshipReplyReviewInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    if (this.output instanceof Error) throw this.output;
    return structuredClone(this.output);
  }
}

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const path = join(directory, "data.json");
  const store = await JsonStore.open(path, false);
  await advancePersistedAiWorld(store, WORLD_AT, "UTC");
  await store.update((data) => {
    data.proactiveQueue.unshift({
      id: "message-1",
      title: "Should I remind you less often?",
      message: "I can keep suggestions quieter if you prefer.",
      reason: "relationship test",
      dueAt: DELIVERED_AT,
      status: "delivered",
      createdAt: WORLD_AT,
      deliveredAt: DELIVERED_AT,
      attempts: 1,
      source: "AGENT_LIFE",
    });
  });
  const reply = await recordRelationshipFeedback(store, {
    signalKey: "chat:reply:message-1",
    proactiveCandidateId: "message-1",
    signal: "reply",
    occurredAt: REPLY_AT,
  }, REPLY_AT);
  const content = await recordRelationshipReplyContent(store, {
    relationshipFeedbackId: reply.record.id,
    text: "这种提醒可以少一点，但重要的事情还是提醒我。",
  }, REPLY_AT);
  return { store, path, reply: reply.record, content: content.record };
}

test("OH-P6: reply content is explicit Earth/user_declared text bound to one observed reply signal", async () => {
  const { store, reply, content } = await initializedStore("our-home-reply-content-");
  assert.equal(reply.provenance, "observed");
  assert.equal(content.world, "EARTH");
  assert.equal(content.provenance, "user_declared");
  assert.equal(content.source, "RELATIONSHIP");
  assert.equal(content.relationshipFeedbackId, reply.id);
  assert.equal(content.proactiveCandidateId, "message-1");

  const duplicate = await recordRelationshipReplyContent(store, {
    relationshipFeedbackId: reply.id,
    text: "这种提醒可以少一点，但重要的事情还是提醒我。",
  }, REPLY_AT);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.id, content.id);
  assert.equal(listRelationshipReplyContent(store).length, 1);

  await assert.rejects(recordRelationshipReplyContent(store, {
    relationshipFeedbackId: reply.id,
    text: "conflicting replacement",
  }, REPLY_AT), /conflicts with the existing reply binding/);
});

test("OH-P6: reply content rejects missing and non-reply relationship signals", async () => {
  const { store } = await initializedStore("our-home-reply-source-");
  await assert.rejects(recordRelationshipReplyContent(store, {
    relationshipFeedbackId: "missing",
    text: "hello",
  }, REPLY_AT), /feedback not found/);

  const like = await recordRelationshipFeedback(store, {
    signalKey: "ui:like:message-1",
    proactiveCandidateId: "message-1",
    signal: "like",
    occurredAt: REPLY_AT,
  }, REPLY_AT);
  await assert.rejects(recordRelationshipReplyContent(store, {
    relationshipFeedbackId: like.record.id,
    text: "hello",
  }, REPLY_AT), /requires a P6.1 reply signal/);
});

test("OH-P6: model can only create an inferred proposal and cannot directly change Preference or Soul", async () => {
  const { store, content } = await initializedStore("our-home-reply-proposal-");
  const queueBefore = structuredClone(store.snapshot().proactiveQueue);
  const observationsBefore = structuredClone(store.snapshot().observations);
  const preferencesBefore = listAiWorldPreferenceStates(store);
  const soulBefore = readAiWorldContinuity(store).soulTendencies ?? [];
  const adapter = new MockReplyReviewAdapter({
    action: "propose_feedback",
    proposal: {
      class: "proactive_messages_less",
      summary: "User explicitly asks for fewer ordinary reminders while retaining important ones.",
    },
  });

  const result = await runRelationshipReplyReviewCycle(store, adapter, REVIEW_AT);
  assert.equal(result.status, "proposed");
  assert.equal(result.attempted, true);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(adapter.calls[0], {
    asOf: REVIEW_AT,
    reply: {
      relationshipFeedbackId: listRelationshipFeedback(store).find((item) => item.signal === "reply")!.id,
      signalKey: "chat:reply:message-1",
      occurredAt: REPLY_AT,
      text: "这种提醒可以少一点，但重要的事情还是提醒我。",
    },
    proactiveMessage: {
      id: "message-1",
      title: "Should I remind you less often?",
      message: "I can keep suggestions quieter if you prefer.",
      deliveredAt: DELIVERED_AT,
    },
  });

  const proposal = listRelationshipReplyProposals(store)[0]!;
  assert.equal(proposal.world, "EARTH");
  assert.equal(proposal.provenance, "inferred");
  assert.equal(proposal.source, "RELATIONSHIP");
  assert.equal(proposal.replyContentId, content.id);
  assert.equal(proposal.proposalClass, "proactive_messages_less");
  assert.equal(proposal.status, "pending");
  assert.equal(listRelationshipReplyContent(store)[0]!.reviewOutcome, "proposed");
  assert.equal(listUserFeedback(store).length, 0);
  assert.deepEqual(listAiWorldPreferenceStates(store), preferencesBefore);
  assert.deepEqual(readAiWorldContinuity(store).soulTendencies ?? [], soulBefore);
  assert.deepEqual(store.snapshot().proactiveQueue, queueBefore);
  assert.deepEqual(store.snapshot().observations, observationsBefore);
});

test("OH-22/OH-P6: strict output rejects hidden reasoning, direct learning and delivery fields", async () => {
  for (const output of [
    {
      action: "propose_feedback",
      proposal: {
        class: "proactive_messages_less",
        summary: "bounded",
        reasoning: "private chain",
      },
    },
    {
      action: "propose_feedback",
      proposal: {
        class: "proactive_messages_less",
        summary: "bounded",
        interestKey: "caller:chosen",
        strength: 1,
        soulDelta: 1,
      },
    },
    {
      action: "propose_feedback",
      proposal: {
        class: "proactive_messages_less",
        summary: "bounded",
      },
      notify: true,
    },
  ]) {
    const { store } = await initializedStore("our-home-reply-strict-");
    const result = await runRelationshipReplyReviewCycle(store, new MockReplyReviewAdapter(output), REVIEW_AT);
    assert.equal(result.status, "provider_failed");
    assert.equal(listRelationshipReplyProposals(store).length, 0);
    assert.equal(listUserFeedback(store).length, 0);
    assert.equal(listAiWorldPreferenceStates(store).length, 0);
    const runtime = readRelationshipReplyReviewRuntimeState(store, REVIEW_AT);
    assert.equal(runtime.attemptsToday, 1);
    assert.ok(runtime.retryAfter);
  }
});

test("OH-P6: ignore records review completion without proposal or Preference evidence", async () => {
  const { store } = await initializedStore("our-home-reply-ignore-");
  const result = await runRelationshipReplyReviewCycle(store, new MockReplyReviewAdapter({ action: "ignore" }), REVIEW_AT);
  assert.equal(result.status, "ignored");
  assert.equal(listRelationshipReplyProposals(store).length, 0);
  assert.equal(listRelationshipReplyContent(store)[0]!.reviewOutcome, "ignored");
  assert.equal(listUserFeedback(store).length, 0);
  assert.equal(listAiWorldPreferenceStates(store).length, 0);
});

test("OH-64/OH-65: relationship reply review obeys failure backoff and success cooldown", async () => {
  const failed = await initializedStore("our-home-reply-backoff-");
  const failingAdapter = new MockReplyReviewAdapter(new Error("provider down"));
  const first = await runRelationshipReplyReviewCycle(failed.store, failingAdapter, REVIEW_AT);
  assert.equal(first.status, "provider_failed");
  const beforeBackoffEnds = new Date(Date.parse(REVIEW_AT) + RELATIONSHIP_REPLY_FAILURE_BACKOFF_MS - 1).toISOString();
  const blocked = await runRelationshipReplyReviewCycle(failed.store, failingAdapter, beforeBackoffEnds);
  assert.equal(blocked.status, "retry_backoff");
  assert.equal(failingAdapter.calls.length, 1);

  const succeeded = await initializedStore("our-home-reply-cooldown-");
  await runRelationshipReplyReviewCycle(succeeded.store, new MockReplyReviewAdapter({ action: "ignore" }), REVIEW_AT);
  const secondReply = await recordRelationshipFeedback(succeeded.store, {
    signalKey: "chat:reply:message-1:second",
    proactiveCandidateId: "message-1",
    signal: "reply",
    occurredAt: "2026-09-05T10:11:00.000Z",
  }, "2026-09-05T10:11:00.000Z");
  await recordRelationshipReplyContent(succeeded.store, {
    relationshipFeedbackId: secondReply.record.id,
    text: "另一个回复",
  }, "2026-09-05T10:11:00.000Z");
  const beforeCooldownEnds = new Date(Date.parse(REVIEW_AT) + RELATIONSHIP_REPLY_SUCCESS_COOLDOWN_MS - 1).toISOString();
  const cooldown = await runRelationshipReplyReviewCycle(
    succeeded.store,
    new MockReplyReviewAdapter({ action: "ignore" }),
    beforeCooldownEnds,
  );
  assert.equal(cooldown.status, "success_cooldown");
  assert.equal(cooldown.attempted, false);
});

test("OH-67/OH-P6: proposal and source lifecycle survive restart without duplicate model calls", async () => {
  const { store, path } = await initializedStore("our-home-reply-restart-");
  const adapter = new MockReplyReviewAdapter({
    action: "propose_feedback",
    proposal: { class: "correction", summary: "User corrects the earlier assumption." },
  });
  const first = await runRelationshipReplyReviewCycle(store, adapter, REVIEW_AT);
  assert.equal(first.status, "proposed");
  const reopened = await JsonStore.open(path, false);
  assert.equal(listRelationshipReplyProposals(reopened).length, 1);
  assert.equal(listRelationshipReplyContent(reopened)[0]!.reviewOutcome, "proposed");
  const second = await runRelationshipReplyReviewCycle(
    reopened,
    new MockReplyReviewAdapter(new Error("must not be called")),
    new Date(Date.parse(REVIEW_AT) + RELATIONSHIP_REPLY_SUCCESS_COOLDOWN_MS + 1).toISOString(),
  );
  assert.equal(second.status, "no_due");
  assert.equal(second.attempted, false);
});
