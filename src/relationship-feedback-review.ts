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
};

export interface RelationshipFeedbackReviewItem {
  feedback: UserFeedbackRecord;
  evidence?: AiWorldInterestEvidence;
  active: boolean;
  earthRevocation?: RelationshipFeedbackRevocationRecord;
  aiWorldRevocation?: AiWorldInterestEvidenceRevocation;
}

function revocationState(store: JsonStore): {
  earth: RelationshipFeedbackRevocationRecord[];
  aiWorld: AiWorldInterestEvidenceRevocation[];
} {
  const snapshot = store.snapshot() as RevocationStoreData;
  const continuity = snapshot.aiWorld?.continuity as RevocationContinuity | undefined;
  const earth = snapshot.relationshipFeedbackRevocations ?? [];
  const aiWorld = continuity?.interestEvidenceRevocations ?? [];
  if (!Array.isArray(earth)) throw new Error("Persisted relationship feedback revocations must be an array");
  if (!Array.isArray(aiWorld)) throw new Error("Persisted AI World evidence revocations must be an array");
  return { earth, aiWorld };
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
  const evidenceById = new Map(listAiWorldInterestEvidence(store).map((item) => [item.id, item]));
  const revocations = revocationState(store);
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
