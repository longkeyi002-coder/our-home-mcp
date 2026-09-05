import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { readAiWorldContinuity } from "../src/ai-world-continuity.js";
import { listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import { recordRelationshipFeedback } from "../src/relationship-feedback.js";
import {
  listRelationshipReplyProposals,
  recordRelationshipReplyContent,
  runRelationshipReplyReviewCycle,
  type RelationshipReplyProposalClass,
  type RelationshipReplyReviewAdapter,
} from "../src/relationship-reply-review.js";
import {
  listRelationshipReplyProposalUserReviews,
  reviewRelationshipReplyProposal,
} from "../src/relationship-reply-proposal-review.js";
import { JsonStore } from "../src/store.js";
import { listUserFeedback } from "../src/user-feedback.js";

const WORLD_AT = "2026-09-05T09:00:00.000Z";
const DELIVERED_AT = "2026-09-05T10:00:00.000Z";
const REPLY_AT = "2026-09-05T10:05:00.000Z";
const PROPOSAL_AT = "2026-09-05T10:10:00.000Z";
const USER_REVIEW_AT = "2026-09-05T10:15:00.000Z";

class ProposalAdapter implements RelationshipReplyReviewAdapter {
  constructor(private readonly proposalClass: RelationshipReplyProposalClass) {}
  async evaluate() {
    return {
      action: "propose_feedback",
      proposal: {
        class: this.proposalClass,
        summary: `Original inferred proposal: ${this.proposalClass}`,
      },
    };
  }
}

async function storeWithProposal(prefix: string, proposalClass: RelationshipReplyProposalClass) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const path = join(directory, "data.json");
  const store = await JsonStore.open(path, false);
  await advancePersistedAiWorld(store, WORLD_AT, "UTC");
  await store.update((data) => {
    data.proactiveQueue.unshift({
      id: "message-1",
      title: "Reminder preference",
      message: "Would you like messages like this?",
      reason: "proposal review test",
      dueAt: DELIVERED_AT,
      status: "delivered",
      createdAt: WORLD_AT,
      deliveredAt: DELIVERED_AT,
      attempts: 1,
      source: "AGENT_LIFE",
    });
  });
  const reply = await recordRelationshipFeedback(store, {
    signalKey: `chat:reply:${proposalClass}`,
    proactiveCandidateId: "message-1",
    signal: "reply",
    occurredAt: REPLY_AT,
  }, REPLY_AT);
  await recordRelationshipReplyContent(store, {
    relationshipFeedbackId: reply.record.id,
    text: "This reply needs bounded interpretation.",
  }, REPLY_AT);
  const proposed = await runRelationshipReplyReviewCycle(store, new ProposalAdapter(proposalClass), PROPOSAL_AT);
  assert.equal(proposed.status, "proposed");
  const proposal = listRelationshipReplyProposals(store)[0]!;
  return { store, path, proposal };
}

test("OH-P6: confirm creates separate user-declared review and uses fixed P4.5 mapping once", async () => {
  const { store, proposal } = await storeWithProposal("our-home-proposal-confirm-", "proactive_messages_less");
  const original = structuredClone(proposal);
  const soulBefore = readAiWorldContinuity(store).soulTendencies ?? [];

  const result = await reviewRelationshipReplyProposal(store, {
    action: "confirm",
    reviewKey: "ui:confirm:proposal-1",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
  }, USER_REVIEW_AT);

  assert.equal(result.feedbackApplied, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.review.world, "EARTH");
  assert.equal(result.review.provenance, "user_declared");
  assert.equal(result.review.action, "confirm");
  assert.equal(result.review.resolvedClass, "proactive_messages_less");
  assert.ok(result.review.derivedUserFeedbackId);
  assert.equal(result.proposal.status, "confirmed");
  assert.equal(result.proposal.resolvedClass, "proactive_messages_less");
  assert.equal(result.proposal.proposalClass, original.proposalClass);
  assert.equal(result.proposal.summary, original.summary);
  assert.equal(result.proposal.provenance, "inferred");

  const feedback = listUserFeedback(store);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0]?.interestKey, "relationship:proactive_messages");
  assert.equal(feedback[0]?.signal, "prefer_less");
  const preference = listAiWorldPreferenceStates(store).find((item) => item.interestKey === "relationship:proactive_messages");
  assert.equal(preference?.score, -0.025);
  assert.deepEqual(readAiWorldContinuity(store).soulTendencies ?? [], soulBefore);
});

test("OH-03/OH-P6: correction inference cannot be confirmed directly into learning", async () => {
  const { store, proposal } = await storeWithProposal("our-home-proposal-correction-confirm-", "correction");
  await assert.rejects(reviewRelationshipReplyProposal(store, {
    action: "confirm",
    reviewKey: "ui:confirm:correction",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
  }, USER_REVIEW_AT), /cannot be confirmed into learning/);

  assert.equal(listRelationshipReplyProposals(store)[0]?.status, "pending");
  assert.equal(listRelationshipReplyProposalUserReviews(store).length, 0);
  assert.equal(listUserFeedback(store).length, 0);
  assert.equal(listAiWorldPreferenceStates(store).length, 0);
});

test("OH-P6: correct requires an explicit fixed directional class and preserves the original inference", async () => {
  const { store, proposal } = await storeWithProposal("our-home-proposal-correct-", "proactive_messages_more");
  const originalSummary = proposal.summary;
  const result = await reviewRelationshipReplyProposal(store, {
    action: "correct",
    reviewKey: "ui:correct:proposal-1",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
    correctedClass: "suggestions_less",
  }, USER_REVIEW_AT);

  assert.equal(result.proposal.status, "corrected");
  assert.equal(result.proposal.proposalClass, "proactive_messages_more");
  assert.equal(result.proposal.summary, originalSummary);
  assert.equal(result.proposal.resolvedClass, "suggestions_less");
  assert.equal(result.review.resolvedClass, "suggestions_less");
  assert.equal(listUserFeedback(store)[0]?.interestKey, "relationship:suggestions");
  assert.equal(listUserFeedback(store)[0]?.signal, "prefer_less");
  assert.equal(listAiWorldPreferenceStates(store).find((item) => item.interestKey === "relationship:suggestions")?.score, -0.025);

  const second = await storeWithProposal("our-home-proposal-correct-same-", "suggestions_more");
  await assert.rejects(reviewRelationshipReplyProposal(second.store, {
    action: "correct",
    reviewKey: "ui:correct:same",
    proposalId: second.proposal.id,
    occurredAt: USER_REVIEW_AT,
    correctedClass: "suggestions_more",
  }, USER_REVIEW_AT), /use confirm instead/);
});

test("OH-P6: correction proposal can only learn after user explicitly chooses a directional class", async () => {
  const { store, proposal } = await storeWithProposal("our-home-proposal-correction-resolve-", "correction");
  const result = await reviewRelationshipReplyProposal(store, {
    action: "correct",
    reviewKey: "ui:correct:correction",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
    correctedClass: "proactive_messages_more",
  }, USER_REVIEW_AT);

  assert.equal(result.proposal.status, "corrected");
  assert.equal(result.proposal.proposalClass, "correction");
  assert.equal(result.proposal.resolvedClass, "proactive_messages_more");
  assert.equal(listUserFeedback(store)[0]?.signal, "prefer_more");
  assert.equal(listAiWorldPreferenceStates(store)[0]?.score, 0.025);
});

test("OH-41/OH-P6: dismiss is terminal and creates no learned feedback", async () => {
  const { store, proposal } = await storeWithProposal("our-home-proposal-dismiss-", "suggestions_more");
  const result = await reviewRelationshipReplyProposal(store, {
    action: "dismiss",
    reviewKey: "ui:dismiss:proposal-1",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
  }, USER_REVIEW_AT);

  assert.equal(result.feedbackApplied, false);
  assert.equal(result.proposal.status, "dismissed");
  assert.equal(result.proposal.resolvedClass, undefined);
  assert.equal(result.review.derivedUserFeedbackId, undefined);
  assert.equal(listUserFeedback(store).length, 0);
  assert.equal(listAiWorldPreferenceStates(store).length, 0);

  await assert.rejects(reviewRelationshipReplyProposal(store, {
    action: "confirm",
    reviewKey: "ui:second-review",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
  }, USER_REVIEW_AT), /already received a terminal user review|Only a pending/);
});

test("OH-52/OH-P6: proposal review strict input rejects arbitrary learning and external-action fields", async () => {
  const { store, proposal } = await storeWithProposal("our-home-proposal-strict-", "proactive_messages_more");
  for (const extra of [
    { interestKey: "caller:chosen" },
    { strength: 1 },
    { soulDelta: 1 },
    { notify: true },
    { actionTarget: "android" },
  ]) {
    await assert.rejects(reviewRelationshipReplyProposal(store, {
      action: "confirm",
      reviewKey: `ui:strict:${Object.keys(extra)[0]}`,
      proposalId: proposal.id,
      occurredAt: USER_REVIEW_AT,
      ...extra,
    }, USER_REVIEW_AT), /strict input contract/);
  }
  assert.equal(listRelationshipReplyProposalUserReviews(store).length, 0);
  assert.equal(listUserFeedback(store).length, 0);
});

test("OH-40/OH-67/OH-P6: exact review replay and restart reconcile through P4.5 without duplicate evidence", async () => {
  const { store, path, proposal } = await storeWithProposal("our-home-proposal-replay-", "suggestions_more");
  const input = {
    action: "confirm" as const,
    reviewKey: "ui:confirm:stable",
    proposalId: proposal.id,
    occurredAt: USER_REVIEW_AT,
  };
  const first = await reviewRelationshipReplyProposal(store, input, USER_REVIEW_AT);
  const second = await reviewRelationshipReplyProposal(store, input, USER_REVIEW_AT);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.review.id, second.review.id);
  assert.equal(listRelationshipReplyProposalUserReviews(store).length, 1);
  assert.equal(listUserFeedback(store).length, 1);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.evidenceCount, 1);

  await assert.rejects(reviewRelationshipReplyProposal(store, {
    ...input,
    action: "dismiss",
  }, USER_REVIEW_AT), /key collision|terminal user review/);

  const reopened = await JsonStore.open(path, false);
  const third = await reviewRelationshipReplyProposal(reopened, input, USER_REVIEW_AT);
  assert.equal(third.duplicate, true);
  assert.equal(listRelationshipReplyProposalUserReviews(reopened).length, 1);
  assert.equal(listUserFeedback(reopened).length, 1);
  assert.equal(listAiWorldPreferenceStates(reopened)[0]?.evidenceCount, 1);
});
