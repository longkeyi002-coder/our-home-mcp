import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  listRelationshipReplyProposals,
  type RelationshipReplyDirectionalClass,
  type RelationshipReplyInterpretationProposal,
} from "./relationship-reply-review.js";
import type { JsonStore } from "./store.js";
import type { OurHomeData } from "./types.js";
import {
  recordAndApplyUserFeedback,
  type RecordAndApplyUserFeedbackResult,
  type UserFeedbackSignal,
} from "./user-feedback.js";

export type RelationshipReplyProposalUserReviewAction = "confirm" | "correct" | "dismiss";

export interface RelationshipReplyProposalUserReviewRecord {
  id: string;
  world: "EARTH";
  provenance: "user_declared";
  source: "RELATIONSHIP";
  reviewKey: string;
  proposalId: string;
  action: RelationshipReplyProposalUserReviewAction;
  resolvedClass?: RelationshipReplyDirectionalClass;
  occurredAt: string;
  createdAt: string;
  derivedUserFeedbackId?: string;
}

type ProposalReviewStoreData = OurHomeData & {
  relationshipReplyProposals?: RelationshipReplyInterpretationProposal[];
  relationshipReplyProposalUserReviews?: RelationshipReplyProposalUserReviewRecord[];
};

const directionalClassSchema = z.enum([
  "proactive_messages_more",
  "proactive_messages_less",
  "suggestions_more",
  "suggestions_less",
]);

const userReviewInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    reviewKey: z.string().trim().min(1).max(300),
    proposalId: z.string().trim().min(1).max(500),
    occurredAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    action: z.literal("correct"),
    reviewKey: z.string().trim().min(1).max(300),
    proposalId: z.string().trim().min(1).max(500),
    occurredAt: z.string().datetime({ offset: true }),
    correctedClass: directionalClassSchema,
  }).strict(),
  z.object({
    action: z.literal("dismiss"),
    reviewKey: z.string().trim().min(1).max(300),
    proposalId: z.string().trim().min(1).max(500),
    occurredAt: z.string().datetime({ offset: true }),
  }).strict(),
]);

type UserReviewInput = z.infer<typeof userReviewInputSchema>;

export interface ReviewRelationshipReplyProposalResult {
  review: RelationshipReplyProposalUserReviewRecord;
  proposal: RelationshipReplyInterpretationProposal;
  duplicate: boolean;
  feedbackApplied: boolean;
  userFeedback?: RecordAndApplyUserFeedbackResult;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function assertUserReview(record: RelationshipReplyProposalUserReviewRecord): void {
  if (record.world !== "EARTH" || record.provenance !== "user_declared" || record.source !== "RELATIONSHIP") {
    throw new Error("Relationship reply proposal user review has an invalid Earth boundary");
  }
  if (!record.id || !record.reviewKey || !record.proposalId) {
    throw new Error("Relationship reply proposal user review has invalid structured fields");
  }
  if (!["confirm", "correct", "dismiss"].includes(record.action)) {
    throw new Error("Relationship reply proposal user review has invalid action");
  }
  const occurredAt = timestamp(record.occurredAt, "proposal user review occurredAt");
  const createdAt = timestamp(record.createdAt, "proposal user review createdAt");
  if (occurredAt > createdAt) throw new Error("Proposal user review cannot occur after creation");
  if (record.action === "dismiss") {
    if (record.resolvedClass || record.derivedUserFeedbackId) {
      throw new Error("Dismissed proposal user review cannot carry learned-feedback metadata");
    }
  } else if (!record.resolvedClass || !directionalClassSchema.safeParse(record.resolvedClass).success) {
    throw new Error("Confirm/correct proposal user review requires a directional resolvedClass");
  }
  if (record.derivedUserFeedbackId !== undefined && !record.derivedUserFeedbackId.trim()) {
    throw new Error("Proposal user review derivedUserFeedbackId is invalid");
  }
}

function userReviewRecords(snapshot: OurHomeData): RelationshipReplyProposalUserReviewRecord[] {
  const records = (snapshot as ProposalReviewStoreData).relationshipReplyProposalUserReviews ?? [];
  if (!Array.isArray(records)) throw new Error("Persisted relationship reply proposal user reviews must be an array");
  const ids = new Set<string>();
  const keys = new Set<string>();
  const proposalIds = new Set<string>();
  for (const record of records) {
    assertUserReview(record);
    if (ids.has(record.id)) throw new Error("Duplicate relationship reply proposal user-review id");
    if (keys.has(record.reviewKey)) throw new Error("Duplicate relationship reply proposal user-review key");
    if (proposalIds.has(record.proposalId)) throw new Error("Relationship reply proposal has multiple terminal user reviews");
    ids.add(record.id);
    keys.add(record.reviewKey);
    proposalIds.add(record.proposalId);
  }
  return records;
}

function sameCanonicalReview(record: RelationshipReplyProposalUserReviewRecord, input: UserReviewInput): boolean {
  const correctedClass = input.action === "correct" ? input.correctedClass : undefined;
  const resolvedClass = input.action === "confirm" ? record.resolvedClass : correctedClass;
  return record.reviewKey === input.reviewKey
    && record.proposalId === input.proposalId
    && record.action === input.action
    && record.occurredAt === input.occurredAt
    && (input.action !== "correct" || record.resolvedClass === resolvedClass);
}

function resolveClass(
  proposal: RelationshipReplyInterpretationProposal,
  input: UserReviewInput,
): RelationshipReplyDirectionalClass | undefined {
  if (input.action === "dismiss") return undefined;
  if (input.action === "confirm") {
    if (proposal.proposalClass === "correction") {
      throw new Error("A correction proposal cannot be confirmed into learning without an explicit corrected class");
    }
    return proposal.proposalClass;
  }
  if (proposal.proposalClass !== "correction" && input.correctedClass === proposal.proposalClass) {
    throw new Error("Correct must choose a class different from the original proposal; use confirm instead");
  }
  return input.correctedClass;
}

function learningPolicy(resolvedClass: RelationshipReplyDirectionalClass): {
  interestKey: string;
  signal: UserFeedbackSignal;
} {
  switch (resolvedClass) {
    case "proactive_messages_more":
      return { interestKey: "relationship:proactive_messages", signal: "prefer_more" };
    case "proactive_messages_less":
      return { interestKey: "relationship:proactive_messages", signal: "prefer_less" };
    case "suggestions_more":
      return { interestKey: "relationship:suggestions", signal: "prefer_more" };
    case "suggestions_less":
      return { interestKey: "relationship:suggestions", signal: "prefer_less" };
  }
}

export function listRelationshipReplyProposalUserReviews(store: JsonStore): RelationshipReplyProposalUserReviewRecord[] {
  return userReviewRecords(store.snapshot())
    .slice()
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
    .map((item) => structuredClone(item));
}

async function persistReviewLifecycle(
  store: JsonStore,
  proposal: RelationshipReplyInterpretationProposal,
  input: UserReviewInput,
  resolvedClass: RelationshipReplyDirectionalClass | undefined,
  asOf: string,
): Promise<{ review: RelationshipReplyProposalUserReviewRecord; proposal: RelationshipReplyInterpretationProposal; duplicate: boolean }> {
  const existingByKey = userReviewRecords(store.snapshot()).find((item) => item.reviewKey === input.reviewKey);
  if (existingByKey) {
    if (!sameCanonicalReview(existingByKey, input)) {
      throw new Error("Relationship reply proposal user-review key collision with different payload");
    }
    const currentProposal = listRelationshipReplyProposals(store).find((item) => item.id === proposal.id);
    if (!currentProposal) throw new Error("Relationship reply proposal disappeared after user review");
    return { review: structuredClone(existingByKey), proposal: currentProposal, duplicate: true };
  }

  const existingForProposal = userReviewRecords(store.snapshot()).find((item) => item.proposalId === proposal.id);
  if (existingForProposal) {
    throw new Error("Relationship reply proposal has already received a terminal user review");
  }
  if (proposal.status !== "pending") {
    throw new Error("Only a pending relationship reply proposal can be reviewed");
  }

  const review: RelationshipReplyProposalUserReviewRecord = {
    id: randomUUID(),
    world: "EARTH",
    provenance: "user_declared",
    source: "RELATIONSHIP",
    reviewKey: input.reviewKey,
    proposalId: proposal.id,
    action: input.action,
    ...(resolvedClass ? { resolvedClass } : {}),
    occurredAt: input.occurredAt,
    createdAt: asOf,
  };

  let persistedReview: RelationshipReplyProposalUserReviewRecord | undefined;
  let persistedProposal: RelationshipReplyInterpretationProposal | undefined;
  let duplicate = false;
  await store.update((raw) => {
    const data = raw as ProposalReviewStoreData;
    const records = userReviewRecords(data);
    const racedKey = records.find((item) => item.reviewKey === input.reviewKey);
    if (racedKey) {
      if (!sameCanonicalReview(racedKey, input)) {
        throw new Error("Relationship reply proposal user-review key collision with different payload");
      }
      persistedReview = racedKey;
      persistedProposal = (data.relationshipReplyProposals ?? []).find((item) => item.id === proposal.id);
      duplicate = true;
      return;
    }
    if (records.some((item) => item.proposalId === proposal.id)) {
      throw new Error("Relationship reply proposal has already received a terminal user review");
    }
    const current = (data.relationshipReplyProposals ?? []).find((item) => item.id === proposal.id);
    if (!current || current.status !== "pending") {
      throw new Error("Only a pending relationship reply proposal can be reviewed");
    }
    data.relationshipReplyProposalUserReviews ??= [];
    data.relationshipReplyProposalUserReviews.unshift(review);
    current.status = input.action === "dismiss" ? "dismissed" : input.action === "confirm" ? "confirmed" : "corrected";
    current.reviewedAt = asOf;
    current.reviewRecordId = review.id;
    if (resolvedClass) current.resolvedClass = resolvedClass;
    persistedReview = review;
    persistedProposal = current;
  });

  if (!persistedReview || !persistedProposal) throw new Error("Relationship reply proposal user review was not persisted");
  return {
    review: structuredClone(persistedReview),
    proposal: structuredClone(persistedProposal),
    duplicate,
  };
}

/**
 * P6.3 explicit user gate. The inferred P6.2 proposal itself never becomes user-declared evidence.
 * Confirm/correct creates a separate user-declared review and then reconciles through P4.5.
 */
export async function reviewRelationshipReplyProposal(
  store: JsonStore,
  rawInput: unknown,
  asOf = new Date().toISOString(),
): Promise<ReviewRelationshipReplyProposalResult> {
  const parsed = userReviewInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new Error("Relationship reply proposal review violated the strict input contract");
  const input = parsed.data;
  const asOfMs = timestamp(asOf, "proposal user review createdAt");
  const occurredAtMs = timestamp(input.occurredAt, "proposal user review occurredAt");
  if (occurredAtMs > asOfMs) throw new Error("Proposal user review cannot occur after creation");

  const proposal = listRelationshipReplyProposals(store).find((item) => item.id === input.proposalId);
  if (!proposal) throw new Error(`Relationship reply proposal not found: ${input.proposalId}`);
  if (occurredAtMs < timestamp(proposal.createdAt, "relationship reply proposal createdAt")) {
    throw new Error("Proposal user review cannot predate proposal creation");
  }

  const resolvedClass = resolveClass(proposal, input);
  const persisted = await persistReviewLifecycle(store, proposal, input, resolvedClass, asOf);

  if (!resolvedClass) {
    return {
      ...persisted,
      feedbackApplied: false,
    };
  }

  const policy = learningPolicy(resolvedClass);
  const applied = await recordAndApplyUserFeedback(store, {
    feedbackKey: `relationship-reply-proposal-review:${persisted.review.id}`,
    interestKey: policy.interestKey,
    signal: policy.signal,
    occurredAt: persisted.review.occurredAt,
    note: `Explicit P6.3 ${persisted.review.action} of inferred reply proposal ${proposal.id}`,
  }, asOf);

  await store.update((raw) => {
    const data = raw as ProposalReviewStoreData;
    const review = (data.relationshipReplyProposalUserReviews ?? []).find((item) => item.id === persisted.review.id);
    if (!review) throw new Error("Proposal user review disappeared during P4.5 reconciliation");
    if (review.derivedUserFeedbackId && review.derivedUserFeedbackId !== applied.feedback.id) {
      throw new Error("Proposal user review is linked to conflicting derived feedback");
    }
    review.derivedUserFeedbackId = applied.feedback.id;
  });

  const reconciledReview = listRelationshipReplyProposalUserReviews(store).find((item) => item.id === persisted.review.id)!;
  const reconciledProposal = listRelationshipReplyProposals(store).find((item) => item.id === proposal.id)!;
  return {
    review: reconciledReview,
    proposal: reconciledProposal,
    duplicate: persisted.duplicate,
    feedbackApplied: true,
    userFeedback: applied,
  };
}
