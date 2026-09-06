import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { JsonStore } from "./store.js";
import type { OurHomeData } from "./types.js";
import {
  recordAndApplyUserFeedback,
  type RecordAndApplyUserFeedbackResult,
  type UserFeedbackSignal,
} from "./user-feedback.js";

export type RelationshipFeedbackSignal =
  | "like"
  | "dislike"
  | "reply"
  | "ignore"
  | "accept_suggestion"
  | "reject_suggestion";

export type RelationshipFeedbackProvenance = "user_declared" | "observed";

export interface RelationshipFeedbackRecord {
  id: string;
  world: "EARTH";
  provenance: RelationshipFeedbackProvenance;
  source: "RELATIONSHIP";
  signalKey: string;
  proactiveCandidateId: string;
  signal: RelationshipFeedbackSignal;
  occurredAt: string;
  createdAt: string;
  /** Present only when this explicit signal was reconciled through the P4.5 Bridge. */
  derivedUserFeedbackId?: string;
}

type RelationshipFeedbackStore = OurHomeData & {
  relationshipFeedback?: RelationshipFeedbackRecord[];
};

const inputSchema = z.object({
  signalKey: z.string().trim().min(1).max(300),
  proactiveCandidateId: z.string().trim().min(1).max(500),
  signal: z.enum(["like", "dislike", "reply", "ignore", "accept_suggestion", "reject_suggestion"]),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

const DECLARED_SIGNALS = new Set<RelationshipFeedbackSignal>([
  "like",
  "dislike",
  "accept_suggestion",
  "reject_suggestion",
]);

const PREFERENCE_POLICY: Partial<Record<RelationshipFeedbackSignal, {
  interestKey: string;
  feedbackSignal: UserFeedbackSignal;
}>> = {
  like: {
    interestKey: "relationship:proactive_messages",
    feedbackSignal: "positive_reaction",
  },
  dislike: {
    interestKey: "relationship:proactive_messages",
    feedbackSignal: "negative_reaction",
  },
  accept_suggestion: {
    interestKey: "relationship:suggestions",
    feedbackSignal: "prefer_more",
  },
  reject_suggestion: {
    interestKey: "relationship:suggestions",
    feedbackSignal: "prefer_less",
  },
};

export interface RecordRelationshipFeedbackResult {
  record: RelationshipFeedbackRecord;
  duplicate: boolean;
}

export interface CaptureRelationshipFeedbackResult extends RecordRelationshipFeedbackResult {
  preferenceApplied: boolean;
  userFeedback?: RecordAndApplyUserFeedbackResult;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function assertRecord(record: RelationshipFeedbackRecord): void {
  if (record.world !== "EARTH" || record.source !== "RELATIONSHIP") {
    throw new Error("Relationship feedback has an invalid Earth boundary");
  }
  const expectedProvenance: RelationshipFeedbackProvenance = DECLARED_SIGNALS.has(record.signal)
    ? "user_declared"
    : "observed";
  if (record.provenance !== expectedProvenance) {
    throw new Error("Relationship feedback provenance does not match signal semantics");
  }
  const parsed = inputSchema.safeParse({
    signalKey: record.signalKey,
    proactiveCandidateId: record.proactiveCandidateId,
    signal: record.signal,
    occurredAt: record.occurredAt,
  });
  if (!record.id || !parsed.success) throw new Error("Relationship feedback has invalid structured fields");
  if (timestamp(record.occurredAt, "relationship feedback occurredAt") > timestamp(record.createdAt, "relationship feedback createdAt")) {
    throw new Error("Relationship feedback cannot occur after creation");
  }
  if (record.derivedUserFeedbackId !== undefined && !record.derivedUserFeedbackId.trim()) {
    throw new Error("Relationship feedback derived user-feedback id is invalid");
  }
}

function records(snapshot: OurHomeData): RelationshipFeedbackRecord[] {
  const items = (snapshot as RelationshipFeedbackStore).relationshipFeedback ?? [];
  if (!Array.isArray(items)) throw new Error("Persisted relationship feedback must be an array");
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const item of items) {
    assertRecord(item);
    if (ids.has(item.id)) throw new Error("Duplicate relationship feedback id");
    if (keys.has(item.signalKey)) throw new Error("Duplicate relationship feedback signalKey");
    ids.add(item.id);
    keys.add(item.signalKey);
  }
  return items;
}

function samePayload(
  record: RelationshipFeedbackRecord,
  input: z.infer<typeof inputSchema>,
): boolean {
  return record.signalKey === input.signalKey
    && record.proactiveCandidateId === input.proactiveCandidateId
    && record.signal === input.signal
    && record.occurredAt === input.occurredAt;
}

function assertDeliveredSubject(store: JsonStore, candidateId: string, occurredAt: string): void {
  const candidate = store.snapshot().proactiveQueue.find((item) => item.id === candidateId);
  if (!candidate || candidate.status !== "delivered" || !candidate.deliveredAt) {
    throw new Error("Relationship feedback requires an existing delivered proactive message");
  }
  if (timestamp(occurredAt, "relationship feedback occurredAt") < timestamp(candidate.deliveredAt, "proactive deliveredAt")) {
    throw new Error("Relationship feedback cannot precede proactive-message delivery");
  }
}

export function listRelationshipFeedback(store: JsonStore): RelationshipFeedbackRecord[] {
  return records(store.snapshot())
    .slice()
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
    .map((item) => structuredClone(item));
}

export async function recordRelationshipFeedback(
  store: JsonStore,
  input: unknown,
  asOf = new Date().toISOString(),
): Promise<RecordRelationshipFeedbackResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("Relationship feedback violated the strict input contract");
  const canonical = parsed.data;
  if (timestamp(canonical.occurredAt, "relationship feedback occurredAt") > timestamp(asOf, "relationship feedback createdAt")) {
    throw new Error("Relationship feedback cannot occur after creation");
  }
  assertDeliveredSubject(store, canonical.proactiveCandidateId, canonical.occurredAt);

  const existing = records(store.snapshot()).find((item) => item.signalKey === canonical.signalKey);
  if (existing) {
    if (!samePayload(existing, canonical)) throw new Error("Relationship feedback signalKey collision with different payload");
    return { record: structuredClone(existing), duplicate: true };
  }

  const record: RelationshipFeedbackRecord = {
    id: randomUUID(),
    world: "EARTH",
    provenance: DECLARED_SIGNALS.has(canonical.signal) ? "user_declared" : "observed",
    source: "RELATIONSHIP",
    ...canonical,
    createdAt: asOf,
  };

  let result: RelationshipFeedbackRecord | undefined;
  let duplicate = false;
  await store.update((raw) => {
    const data = raw as RelationshipFeedbackStore;
    const current = records(data);
    const raced = current.find((item) => item.signalKey === canonical.signalKey);
    if (raced) {
      if (!samePayload(raced, canonical)) throw new Error("Relationship feedback signalKey collision with different payload");
      result = raced;
      duplicate = true;
      return;
    }
    data.relationshipFeedback ??= [];
    data.relationshipFeedback.unshift(record);
    result = record;
  });
  if (!result) throw new Error("Relationship feedback was not persisted");
  return { record: structuredClone(result), duplicate };
}

/**
 * Captures one product-level relationship signal. Only explicit valenced signals are translated
 * through the existing P4.5 Bridge. Reply/ignore remain traceable Earth interaction evidence and
 * cannot silently reinforce or punish a Preference.
 */
export async function captureRelationshipFeedback(
  store: JsonStore,
  input: unknown,
  asOf = new Date().toISOString(),
): Promise<CaptureRelationshipFeedbackResult> {
  const recorded = await recordRelationshipFeedback(store, input, asOf);
  const policy = PREFERENCE_POLICY[recorded.record.signal];
  if (!policy) {
    return { ...recorded, preferenceApplied: false };
  }

  const applied = await recordAndApplyUserFeedback(store, {
    feedbackKey: `relationship-signal:${recorded.record.signalKey}`,
    interestKey: policy.interestKey,
    signal: policy.feedbackSignal,
    occurredAt: recorded.record.occurredAt,
  }, asOf);

  await store.update((raw) => {
    const data = raw as RelationshipFeedbackStore;
    const item = (data.relationshipFeedback ?? []).find((candidate) => candidate.id === recorded.record.id);
    if (!item) throw new Error(`Relationship feedback disappeared during P4.5 Bridge application: ${recorded.record.id}`);
    if (item.derivedUserFeedbackId && item.derivedUserFeedbackId !== applied.feedback.id) {
      throw new Error("Relationship feedback is linked to conflicting P4.5 feedback");
    }
    item.derivedUserFeedbackId = applied.feedback.id;
  });

  const reconciled = records(store.snapshot()).find((item) => item.id === recorded.record.id)!;
  return {
    record: structuredClone(reconciled),
    duplicate: recorded.duplicate,
    preferenceApplied: true,
    userFeedback: applied,
  };
}
