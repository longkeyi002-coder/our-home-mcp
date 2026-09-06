import { randomUUID } from "node:crypto";
import {
  MAX_PREFERENCE_EVIDENCE_IDS,
  PREFERENCE_REVIEW_INTERVAL_MS,
  derivePreferenceScore,
} from "./ai-world-preference.js";
import type { JsonStore } from "./store.js";
import {
  listUserFeedback,
  recordAndApplyUserFeedback,
  type UserFeedbackRecord,
  type UserFeedbackSignal,
} from "./user-feedback.js";
import type {
  AiWorldInterestEvidence,
  AiWorldPreferenceState,
  OurHomeData,
} from "./types.js";
import type {
  AiWorldInterestEvidenceRevocation,
  RelationshipFeedbackRevocationRecord,
} from "./relationship-feedback-review.js";

export type CorrectionSignal = Extract<UserFeedbackSignal, "correction_support" | "correction_counter">;

type RevocationStoreData = OurHomeData & {
  relationshipFeedbackRevocations?: RelationshipFeedbackRevocationRecord[];
};

type RevocationContinuity = NonNullable<NonNullable<OurHomeData["aiWorld"]>["continuity"]> & {
  interestEvidenceRevocations?: AiWorldInterestEvidenceRevocation[];
  revokedInterestEvidence?: AiWorldInterestEvidence[];
};

export interface RevokeRelationshipFeedbackResult {
  feedback: UserFeedbackRecord;
  earthRevocation: RelationshipFeedbackRevocationRecord;
  aiWorldRevocation: AiWorldInterestEvidenceRevocation;
  archivedEvidence: AiWorldInterestEvidence;
  preference?: AiWorldPreferenceState;
  duplicate: boolean;
}

export interface CorrectRelationshipFeedbackResult extends RevokeRelationshipFeedbackResult {
  replacementFeedback: UserFeedbackRecord;
  replacementEvidence: AiWorldInterestEvidence;
  replacementPreference: AiWorldPreferenceState;
  replacementDuplicate: boolean;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function boundedText(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty`);
  if (trimmed.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return trimmed;
}

function revocationStore(snapshot: OurHomeData): RevocationStoreData {
  return snapshot as RevocationStoreData;
}

function continuityOf(data: OurHomeData): RevocationContinuity {
  if (!data.aiWorld?.continuity) throw new Error("AI World continuity must exist before relationship evidence revocation");
  return data.aiWorld.continuity as RevocationContinuity;
}

function sameEarthRevocation(
  record: RelationshipFeedbackRevocationRecord,
  input: { revocationKey: string; feedbackId: string; occurredAt: string; note?: string },
): boolean {
  return record.revocationKey === input.revocationKey
    && record.feedbackId === input.feedbackId
    && record.occurredAt === input.occurredAt
    && (record.note ?? undefined) === (input.note ?? undefined);
}

function preferenceForActiveEvidence(
  activeEvidence: AiWorldInterestEvidence[],
  interestKey: string,
  asOf: string,
  existing?: AiWorldPreferenceState,
): AiWorldPreferenceState | undefined {
  if (activeEvidence.length === 0) return undefined;
  const sorted = [...activeEvidence].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
    || left.evidenceKey.localeCompare(right.evidenceKey)
    || left.id.localeCompare(right.id));
  const score = derivePreferenceScore(sorted, asOf);
  return {
    id: existing?.id ?? randomUUID(),
    world: "AI_WORLD",
    provenance: "inferred",
    source: "AGENT_LIFE",
    interestKey,
    score,
    evidenceCount: sorted.length,
    evidenceIds: sorted.slice(-MAX_PREFERENCE_EVIDENCE_IDS).map((item) => item.id),
    lastEvidenceAt: sorted[sorted.length - 1]!.occurredAt,
    lastEvaluatedAt: asOf,
    ...(score !== 0
      ? { nextReviewAt: new Date(timestamp(asOf, "preference rebuild time") + PREFERENCE_REVIEW_INTERVAL_MS).toISOString() }
      : {}),
    createdAt: existing?.createdAt ?? asOf,
    updatedAt: asOf,
  };
}

/** Persist only the Earth/user-declared revocation fact. Replay with the same canonical key is idempotent. */
export async function recordRelationshipFeedbackRevocation(
  store: JsonStore,
  input: {
    revocationKey: string;
    feedbackId: string;
    occurredAt: string;
    note?: string;
  },
  asOf = new Date().toISOString(),
): Promise<{ record: RelationshipFeedbackRevocationRecord; duplicate: boolean }> {
  const revocationKey = boundedText(input.revocationKey, "revocationKey", 300);
  const feedbackId = boundedText(input.feedbackId, "feedbackId", 200);
  const note = input.note === undefined ? undefined : boundedText(input.note, "revocation note", 2_000);
  if (timestamp(input.occurredAt, "revocation occurredAt") > timestamp(asOf, "revocation createdAt")) {
    throw new Error("Relationship feedback revocation cannot occur after creation");
  }

  const feedback = listUserFeedback(store).find((item) => item.id === feedbackId);
  if (!feedback) throw new Error(`User feedback not found: ${feedbackId}`);
  const canonical = { revocationKey, feedbackId, occurredAt: input.occurredAt, ...(note ? { note } : {}) };

  const snapshot = revocationStore(store.snapshot());
  const existing = (snapshot.relationshipFeedbackRevocations ?? []).find((item) => item.revocationKey === revocationKey);
  if (existing) {
    if (!sameEarthRevocation(existing, canonical)) throw new Error("Relationship revocation key collision with different payload");
    return { record: structuredClone(existing), duplicate: true };
  }
  if ((snapshot.relationshipFeedbackRevocations ?? []).some((item) => item.feedbackId === feedbackId)) {
    throw new Error("Relationship feedback has already been revoked");
  }

  const record: RelationshipFeedbackRevocationRecord = {
    id: randomUUID(),
    world: "EARTH",
    provenance: "user_declared",
    source: "RELATIONSHIP",
    revocationKey,
    feedbackId,
    occurredAt: input.occurredAt,
    createdAt: asOf,
    ...(note ? { note } : {}),
  };

  let result: RelationshipFeedbackRevocationRecord | undefined;
  let duplicate = false;
  await store.update((raw) => {
    const data = revocationStore(raw);
    data.relationshipFeedbackRevocations ??= [];
    const raced = data.relationshipFeedbackRevocations.find((item) => item.revocationKey === revocationKey);
    if (raced) {
      if (!sameEarthRevocation(raced, canonical)) throw new Error("Relationship revocation key collision with different payload");
      result = raced;
      duplicate = true;
      return;
    }
    if (data.relationshipFeedbackRevocations.some((item) => item.feedbackId === feedbackId)) {
      throw new Error("Relationship feedback has already been revoked");
    }
    data.relationshipFeedbackRevocations.unshift(record);
    result = record;
  });
  if (!result) throw new Error("Relationship feedback revocation was not persisted");
  return { record: structuredClone(result), duplicate };
}

/**
 * Reconciles one Earth revocation into AI World without deleting history:
 * the original evidence moves from the active reducer collection to a read-only audit archive,
 * a separate inferred revocation record is appended, and temporary Preference is rebuilt only
 * from the remaining active evidence. Existing Soul state/audit is untouched.
 */
export async function applyRelationshipFeedbackRevocation(
  store: JsonStore,
  revocationId: string,
  asOf = new Date().toISOString(),
): Promise<RevokeRelationshipFeedbackResult> {
  const asOfMs = timestamp(asOf, "revocation application time");
  const snapshot = revocationStore(store.snapshot());
  const earthRevocation = (snapshot.relationshipFeedbackRevocations ?? []).find((item) => item.id === revocationId);
  if (!earthRevocation) throw new Error(`Relationship feedback revocation not found: ${revocationId}`);
  if (asOfMs < timestamp(earthRevocation.createdAt, "revocation createdAt")) {
    throw new Error("Relationship feedback revocation cannot be applied before creation");
  }
  const feedback = listUserFeedback(store).find((item) => item.id === earthRevocation.feedbackId);
  if (!feedback) throw new Error(`User feedback not found: ${earthRevocation.feedbackId}`);
  if (!feedback.derivedEvidenceId) throw new Error("User feedback has no derived evidence to revoke");

  let result: RevokeRelationshipFeedbackResult | undefined;
  await store.update((raw) => {
    const data = revocationStore(raw);
    const currentEarth = (data.relationshipFeedbackRevocations ?? []).find((item) => item.id === revocationId);
    if (!currentEarth) throw new Error(`Relationship feedback revocation disappeared: ${revocationId}`);
    const continuity = continuityOf(data);
    continuity.interestEvidenceRevocations ??= [];
    continuity.revokedInterestEvidence ??= [];
    continuity.interestEvidence ??= [];
    continuity.preferences ??= [];

    const evidenceId = feedback.derivedEvidenceId!;
    const alreadyRevoked = continuity.interestEvidenceRevocations.find((item) => item.feedbackId === feedback.id);
    if (alreadyRevoked) {
      if (alreadyRevoked.evidenceId !== evidenceId || alreadyRevoked.revocationKey !== `feedback-revocation:${currentEarth.id}`) {
        throw new Error("Conflicting AI World evidence revocation exists for feedback");
      }
      const archived = continuity.revokedInterestEvidence.find((item) => item.id === evidenceId);
      if (!archived) throw new Error("AI World revocation exists without archived evidence");
      const preference = continuity.preferences.find((item) => item.interestKey === feedback.interestKey);
      currentEarth.derivedEvidenceRevocationId = alreadyRevoked.id;
      result = {
        feedback: structuredClone(feedback),
        earthRevocation: structuredClone(currentEarth),
        aiWorldRevocation: structuredClone(alreadyRevoked),
        archivedEvidence: structuredClone(archived),
        ...(preference ? { preference: structuredClone(preference) } : {}),
        duplicate: true,
      };
      return;
    }

    const activeIndex = continuity.interestEvidence.findIndex((item) => item.id === evidenceId);
    const archivedExisting = continuity.revokedInterestEvidence.find((item) => item.id === evidenceId);
    const evidence = activeIndex >= 0 ? continuity.interestEvidence[activeIndex]! : archivedExisting;
    if (!evidence) throw new Error(`Derived AI World evidence not found: ${evidenceId}`);
    if (evidence.interestKey !== feedback.interestKey
      || !(evidence.evidenceRefs ?? []).includes(`earth-user-feedback:${feedback.id}`)) {
      throw new Error("Derived evidence does not match the exact feedback boundary");
    }

    if (activeIndex >= 0) {
      continuity.interestEvidence.splice(activeIndex, 1);
      if (!archivedExisting) continuity.revokedInterestEvidence.unshift(structuredClone(evidence));
    }

    const aiWorldRevocation: AiWorldInterestEvidenceRevocation = {
      id: randomUUID(),
      world: "AI_WORLD",
      provenance: "inferred",
      source: "AGENT_LIFE",
      revocationKey: `feedback-revocation:${currentEarth.id}`,
      feedbackId: feedback.id,
      evidenceId: evidence.id,
      interestKey: feedback.interestKey,
      occurredAt: currentEarth.occurredAt,
      createdAt: asOf,
      evidenceRefs: [
        `earth-user-feedback-revocation:${currentEarth.id}`,
        `ai-world-interest-evidence:${evidence.id}`,
      ],
    };
    continuity.interestEvidenceRevocations.unshift(aiWorldRevocation);
    currentEarth.derivedEvidenceRevocationId = aiWorldRevocation.id;

    const activeForInterest = continuity.interestEvidence.filter((item) => item.interestKey === feedback.interestKey);
    const preferenceIndex = continuity.preferences.findIndex((item) => item.interestKey === feedback.interestKey);
    const existingPreference = preferenceIndex >= 0 ? continuity.preferences[preferenceIndex] : undefined;
    const rebuilt = preferenceForActiveEvidence(activeForInterest, feedback.interestKey, asOf, existingPreference);
    if (rebuilt) {
      if (preferenceIndex >= 0) continuity.preferences[preferenceIndex] = rebuilt;
      else continuity.preferences.push(rebuilt);
    } else if (preferenceIndex >= 0) {
      continuity.preferences.splice(preferenceIndex, 1);
    }

    result = {
      feedback: structuredClone(feedback),
      earthRevocation: structuredClone(currentEarth),
      aiWorldRevocation: structuredClone(aiWorldRevocation),
      archivedEvidence: structuredClone(evidence),
      ...(rebuilt ? { preference: structuredClone(rebuilt) } : {}),
      duplicate: false,
    };
  });

  if (!result) throw new Error("Relationship feedback revocation was not applied");
  return result;
}

export async function revokeRelationshipFeedback(
  store: JsonStore,
  input: {
    revocationKey: string;
    feedbackId: string;
    occurredAt: string;
    note?: string;
  },
  asOf = new Date().toISOString(),
): Promise<RevokeRelationshipFeedbackResult> {
  const recorded = await recordRelationshipFeedbackRevocation(store, input, asOf);
  const applied = await applyRelationshipFeedbackRevocation(store, recorded.record.id, asOf);
  return { ...applied, duplicate: recorded.duplicate && applied.duplicate };
}

/** Revoke the exact old evidence first, then record one bounded P4.5 correction as new evidence. */
export async function correctRelationshipFeedback(
  store: JsonStore,
  input: {
    revocationKey: string;
    feedbackId: string;
    occurredAt: string;
    note?: string;
    correction: {
      feedbackKey: string;
      interestKey: string;
      signal: CorrectionSignal;
      occurredAt: string;
      note?: string;
    };
  },
  asOf = new Date().toISOString(),
): Promise<CorrectRelationshipFeedbackResult> {
  if (input.correction.signal !== "correction_support" && input.correction.signal !== "correction_counter") {
    throw new Error("Relationship correction must use a bounded correction signal");
  }
  const revoked = await revokeRelationshipFeedback(store, {
    revocationKey: input.revocationKey,
    feedbackId: input.feedbackId,
    occurredAt: input.occurredAt,
    ...(input.note ? { note: input.note } : {}),
  }, asOf);
  const replacement = await recordAndApplyUserFeedback(store, input.correction, asOf);
  return {
    ...revoked,
    replacementFeedback: replacement.feedback,
    replacementEvidence: replacement.evidence,
    replacementPreference: replacement.preference,
    replacementDuplicate: replacement.feedbackDuplicate && replacement.duplicate,
  };
}
