import { listAiWorldInterestEvidence } from "./ai-world-preference.js";
import type { JsonStore } from "./store.js";
import { listUserFeedback, type UserFeedbackRecord } from "./user-feedback.js";
import type { AiWorldInterestEvidence, OurHomeData } from "./types.js";

export const MAX_RELATIONSHIP_FEEDBACK_REVIEW_ITEMS = 200;

export interface RelationshipFeedbackRevocationRecord {
  id: string;
  world: "EARTH";
  provenance: "user_declared";
  source: "RELATIONSHIP";
  revocationKey: string;
  feedbackId: string;
  occurredAt: string;
  createdAt: string;
  note?: string;
  derivedEvidenceRevocationId?: string;
}

export interface AiWorldInterestEvidenceRevocation {
  id: string;
  world: "AI_WORLD";
  provenance: "inferred";
  source: "AGENT_LIFE";
  revocationKey: string;
  feedbackId: string;
  evidenceId: string;
  interestKey: string;
  occurredAt: string;
  createdAt: string;
  evidenceRefs: string[];
}

type RevocationStoreData = OurHomeData & {
  relationshipFeedbackRevocations?: RelationshipFeedbackRevocationRecord[];
};

type RevocationContinuity = NonNullable<NonNullable<OurHomeData["aiWorld"]>["continuity"]> & {
  interestEvidenceRevocations?: AiWorldInterestEvidenceRevocation[];
  revokedInterestEvidence?: AiWorldInterestEvidence[];
};

export interface RelationshipFeedbackReviewItem {
  feedback: UserFeedbackRecord;
  evidence?: AiWorldInterestEvidence;
  active: boolean;
  earthRevocation?: RelationshipFeedbackRevocationRecord;
  aiWorldRevocation?: AiWorldInterestEvidenceRevocation;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function assertEarthRevocations(records: RelationshipFeedbackRevocationRecord[]): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const feedbackIds = new Set<string>();
  for (const record of records) {
    if (record.world !== "EARTH" || record.provenance !== "user_declared" || record.source !== "RELATIONSHIP") {
      throw new Error("Relationship feedback revocation has an invalid Earth boundary");
    }
    if (!record.id?.trim() || !record.revocationKey?.trim() || !record.feedbackId?.trim()) {
      throw new Error("Relationship feedback revocation has invalid structured fields");
    }
    if (timestamp(record.occurredAt, "relationship revocation occurredAt") > timestamp(record.createdAt, "relationship revocation createdAt")) {
      throw new Error("Relationship feedback revocation cannot occur after creation");
    }
    if (record.note !== undefined && (!record.note.trim() || record.note.length > 2_000)) {
      throw new Error("Relationship feedback revocation note is invalid");
    }
    if (record.derivedEvidenceRevocationId !== undefined && !record.derivedEvidenceRevocationId.trim()) {
      throw new Error("Relationship feedback revocation derived evidence id is invalid");
    }
    if (ids.has(record.id) || keys.has(record.revocationKey) || feedbackIds.has(record.feedbackId)) {
      throw new Error("Duplicate relationship feedback revocation identity");
    }
    ids.add(record.id);
    keys.add(record.revocationKey);
    feedbackIds.add(record.feedbackId);
  }
}

function revocationState(store: JsonStore): {
  earth: RelationshipFeedbackRevocationRecord[];
  aiWorld: AiWorldInterestEvidenceRevocation[];
  archivedEvidence: AiWorldInterestEvidence[];
} {
  const snapshot = store.snapshot() as RevocationStoreData;
  const continuity = snapshot.aiWorld?.continuity as RevocationContinuity | undefined;
  const earth = snapshot.relationshipFeedbackRevocations ?? [];
  const aiWorld = continuity?.interestEvidenceRevocations ?? [];
  const archivedEvidence = continuity?.revokedInterestEvidence ?? [];
  if (!Array.isArray(earth)) throw new Error("Persisted relationship feedback revocations must be an array");
  if (!Array.isArray(aiWorld)) throw new Error("Persisted AI World evidence revocations must be an array");
  if (!Array.isArray(archivedEvidence)) throw new Error("Persisted revoked AI World evidence archive must be an array");
  assertEarthRevocations(earth);
  return { earth, aiWorld, archivedEvidence };
}

/**
 * Bounded audit view for P6.4. Original Earth feedback and original AI World evidence remain
 * visible even after later revocation; callers never receive hidden replacement state.
 */
export function listRelationshipFeedbackReview(
  store: JsonStore,
  limit = MAX_RELATIONSHIP_FEEDBACK_REVIEW_ITEMS,
): RelationshipFeedbackReviewItem[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RELATIONSHIP_FEEDBACK_REVIEW_ITEMS) {
    throw new Error(`Relationship feedback review limit must be between 1 and ${MAX_RELATIONSHIP_FEEDBACK_REVIEW_ITEMS}`);
  }

  const feedback = listUserFeedback(store);
  const revocations = revocationState(store);
  const evidenceById = new Map<string, AiWorldInterestEvidence>();
  for (const item of listAiWorldInterestEvidence(store)) evidenceById.set(item.id, item);
  for (const item of revocations.archivedEvidence) evidenceById.set(item.id, item);
  const earthByFeedback = new Map(revocations.earth.map((item) => [item.feedbackId, item]));
  const aiByFeedback = new Map(revocations.aiWorld.map((item) => [item.feedbackId, item]));

  return feedback.slice(0, limit).map((item) => {
    const evidence = item.derivedEvidenceId ? evidenceById.get(item.derivedEvidenceId) : undefined;
    const earthRevocation = earthByFeedback.get(item.id);
    const aiWorldRevocation = aiByFeedback.get(item.id);
    return {
      feedback: structuredClone(item),
      ...(evidence ? { evidence: structuredClone(evidence) } : {}),
      active: !earthRevocation && !aiWorldRevocation,
      ...(earthRevocation ? { earthRevocation: structuredClone(earthRevocation) } : {}),
      ...(aiWorldRevocation ? { aiWorldRevocation: structuredClone(aiWorldRevocation) } : {}),
    };
  });
}
