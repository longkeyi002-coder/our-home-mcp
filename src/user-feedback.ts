import { randomUUID } from "node:crypto";
import { addAiWorldInterestEvidence, type ApplyInterestEvidenceResult } from "./ai-world-preference.js";
import type { JsonStore } from "./store.js";
import type { AiWorldInterestEvidenceDirection, OurHomeData } from "./types.js";

export type UserFeedbackSignal =
  | "prefer_more"
  | "prefer_less"
  | "positive_reaction"
  | "negative_reaction"
  | "correction_support"
  | "correction_counter";

/**
 * A user feedback event is an Earth relationship fact. It is never silently relabeled as
 * an AI World fact; the Bridge creates a separate bounded AI World InterestEvidence record.
 */
export interface UserFeedbackRecord {
  id: string;
  world: "EARTH";
  provenance: "user_declared";
  source: "RELATIONSHIP";
  feedbackKey: string;
  interestKey: string;
  signal: UserFeedbackSignal;
  note?: string;
  occurredAt: string;
  createdAt: string;
  /** Filled after the deterministic Bridge has reconciled the derived P4.2 evidence. */
  derivedEvidenceId?: string;
}

type FeedbackStoreData = OurHomeData & { userFeedback?: UserFeedbackRecord[] };

export interface UserFeedbackPolicy {
  direction: AiWorldInterestEvidenceDirection;
  strength: number;
}

export interface RecordUserFeedbackResult {
  feedback: UserFeedbackRecord;
  duplicate: boolean;
}

export interface ApplyUserFeedbackResult extends ApplyInterestEvidenceResult {
  feedback: UserFeedbackRecord;
}

export interface RecordAndApplyUserFeedbackResult extends ApplyUserFeedbackResult {
  feedbackDuplicate: boolean;
}

const SIGNAL_POLICY: Readonly<Record<UserFeedbackSignal, UserFeedbackPolicy>> = {
  prefer_more: { direction: "support", strength: 0.5 },
  prefer_less: { direction: "counter", strength: 0.5 },
  positive_reaction: { direction: "support", strength: 0.25 },
  negative_reaction: { direction: "counter", strength: 0.25 },
  correction_support: { direction: "support", strength: 1 },
  correction_counter: { direction: "counter", strength: 1 },
};

const SIGNALS = new Set<UserFeedbackSignal>(Object.keys(SIGNAL_POLICY) as UserFeedbackSignal[]);

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

function normalizeInterestKey(value: string): string {
  return boundedText(value, "feedback interestKey", 200).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizeFeedbackKey(value: string): string {
  return boundedText(value, "feedbackKey", 300);
}

function assertFeedback(record: UserFeedbackRecord): void {
  if (record.world !== "EARTH" || record.provenance !== "user_declared" || record.source !== "RELATIONSHIP") {
    throw new Error("User feedback has an invalid Earth boundary");
  }
  if (!record.id || !record.feedbackKey || !record.interestKey || !SIGNALS.has(record.signal)) {
    throw new Error("User feedback has invalid structured fields");
  }
  const occurredAt = timestamp(record.occurredAt, "feedback occurredAt");
  const createdAt = timestamp(record.createdAt, "feedback createdAt");
  if (occurredAt > createdAt) throw new Error("User feedback cannot occur after creation");
  if (record.note !== undefined && (!record.note.trim() || record.note.length > 2_000)) {
    throw new Error("User feedback note is invalid");
  }
  if (record.derivedEvidenceId !== undefined && !record.derivedEvidenceId.trim()) {
    throw new Error("User feedback derivedEvidenceId is invalid");
  }
}

function feedbackRecords(snapshot: OurHomeData): UserFeedbackRecord[] {
  const records = (snapshot as FeedbackStoreData).userFeedback ?? [];
  if (!Array.isArray(records)) throw new Error("Persisted user feedback must be an array");
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const record of records) {
    assertFeedback(record);
    if (ids.has(record.id)) throw new Error("Duplicate user feedback id");
    if (keys.has(record.feedbackKey)) throw new Error("Duplicate user feedback key");
    ids.add(record.id);
    keys.add(record.feedbackKey);
  }
  return records;
}

function sameCanonicalPayload(
  record: UserFeedbackRecord,
  input: { interestKey: string; signal: UserFeedbackSignal; occurredAt: string; note?: string },
): boolean {
  return record.interestKey === input.interestKey
    && record.signal === input.signal
    && record.occurredAt === input.occurredAt
    && (record.note ?? undefined) === (input.note ?? undefined);
}

export function userFeedbackPolicy(signal: UserFeedbackSignal): UserFeedbackPolicy {
  if (!SIGNALS.has(signal)) throw new Error(`Invalid user feedback signal: ${signal}`);
  return { ...SIGNAL_POLICY[signal] };
}

export function listUserFeedback(store: JsonStore, interest?: string): UserFeedbackRecord[] {
  const normalizedInterest = interest === undefined ? undefined : normalizeInterestKey(interest);
  return feedbackRecords(store.snapshot())
    .filter((item) => normalizedInterest === undefined || item.interestKey === normalizedInterest)
    .slice()
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
    .map((item) => structuredClone(item));
}

/** Persists only the Earth/user-declared feedback event. No AI World or Soul mutation occurs here. */
export async function recordUserFeedback(
  store: JsonStore,
  input: {
    feedbackKey: string;
    interestKey: string;
    signal: UserFeedbackSignal;
    occurredAt: string;
    note?: string;
  },
  asOf = new Date().toISOString(),
): Promise<RecordUserFeedbackResult> {
  const feedbackKey = normalizeFeedbackKey(input.feedbackKey);
  const interestKey = normalizeInterestKey(input.interestKey);
  if (!SIGNALS.has(input.signal)) throw new Error(`Invalid user feedback signal: ${input.signal}`);
  const occurredAt = input.occurredAt;
  if (timestamp(occurredAt, "feedback occurredAt") > timestamp(asOf, "feedback createdAt")) {
    throw new Error("User feedback cannot occur after creation");
  }
  const note = input.note === undefined ? undefined : boundedText(input.note, "feedback note", 2_000);
  const canonicalInput = { interestKey, signal: input.signal, occurredAt, ...(note ? { note } : {}) };

  const existing = feedbackRecords(store.snapshot()).find((item) => item.feedbackKey === feedbackKey);
  if (existing) {
    if (!sameCanonicalPayload(existing, canonicalInput)) {
      throw new Error("User feedback key collision with different payload");
    }
    return { feedback: structuredClone(existing), duplicate: true };
  }

  const record: UserFeedbackRecord = {
    id: randomUUID(),
    world: "EARTH",
    provenance: "user_declared",
    source: "RELATIONSHIP",
    feedbackKey,
    interestKey,
    signal: input.signal,
    occurredAt,
    createdAt: asOf,
    ...(note ? { note } : {}),
  };

  let result: UserFeedbackRecord | undefined;
  let duplicate = false;
  await store.update((raw) => {
    const data = raw as FeedbackStoreData;
    const records = feedbackRecords(data);
    const raced = records.find((item) => item.feedbackKey === feedbackKey);
    if (raced) {
      if (!sameCanonicalPayload(raced, canonicalInput)) {
        throw new Error("User feedback key collision with different payload");
      }
      result = raced;
      duplicate = true;
      return;
    }
    data.userFeedback ??= [];
    data.userFeedback.unshift(record);
    result = record;
  });
  if (!result) throw new Error("User feedback was not persisted");
  return { feedback: structuredClone(result), duplicate };
}

/**
 * Deterministically translates one persisted Earth feedback event into one P4.2 evidence item.
 * The caller supplies no strength, direction, Preference score, Soul score or Soul delta.
 */
export async function applyUserFeedbackToPreference(
  store: JsonStore,
  feedbackId: string,
  asOf = new Date().toISOString(),
): Promise<ApplyUserFeedbackResult> {
  timestamp(asOf, "feedback application time");
  const feedback = feedbackRecords(store.snapshot()).find((item) => item.id === feedbackId);
  if (!feedback) throw new Error(`User feedback not found: ${feedbackId}`);
  if (timestamp(asOf, "feedback application time") < timestamp(feedback.createdAt, "feedback createdAt")) {
    throw new Error("User feedback cannot be applied before it was created");
  }
  const policy = userFeedbackPolicy(feedback.signal);
  const applied = await addAiWorldInterestEvidence(store, {
    interestKey: feedback.interestKey,
    evidenceKey: `user-feedback:${feedback.id}`,
    direction: policy.direction,
    strength: policy.strength,
    reason: `Bounded user feedback: ${feedback.signal}`,
    provenance: "inferred",
    occurredAt: feedback.occurredAt,
    evidenceRefs: [`earth-user-feedback:${feedback.id}`],
  }, asOf);

  await store.update((raw) => {
    const data = raw as FeedbackStoreData;
    const record = (data.userFeedback ?? []).find((item) => item.id === feedback.id);
    if (!record) throw new Error(`User feedback disappeared during Bridge application: ${feedback.id}`);
    if (record.derivedEvidenceId && record.derivedEvidenceId !== applied.evidence.id) {
      throw new Error("User feedback is linked to conflicting derived evidence");
    }
    record.derivedEvidenceId = applied.evidence.id;
  });

  const reconciled = feedbackRecords(store.snapshot()).find((item) => item.id === feedback.id)!;
  return { ...applied, feedback: structuredClone(reconciled) };
}

export async function recordAndApplyUserFeedback(
  store: JsonStore,
  input: {
    feedbackKey: string;
    interestKey: string;
    signal: UserFeedbackSignal;
    occurredAt: string;
    note?: string;
  },
  asOf = new Date().toISOString(),
): Promise<RecordAndApplyUserFeedbackResult> {
  const recorded = await recordUserFeedback(store, input, asOf);
  const applied = await applyUserFeedbackToPreference(store, recorded.feedback.id, asOf);
  return { ...applied, feedbackDuplicate: recorded.duplicate };
}
