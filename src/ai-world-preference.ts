import { randomUUID } from "node:crypto";
import { assertValidAiWorldData } from "./ai-world.js";
import { assertValidRecordBoundary } from "./record-boundary.js";
import type { JsonStore } from "./store.js";
import type {
  AiWorldContinuityData,
  AiWorldInterestEvidence,
  AiWorldInterestEvidenceDirection,
  AiWorldItemProvenance,
  AiWorldPreferenceState,
  OurHomeData,
} from "./types.js";

export const MAX_SINGLE_EVIDENCE_DELTA = 0.05;
export const PREFERENCE_DAILY_DECAY = 0.005;
export const PREFERENCE_REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_PREFERENCE_EVIDENCE_IDS = 100;

const DAY_MS = 24 * 60 * 60 * 1_000;
const PROVENANCES = new Set<AiWorldItemProvenance>(["inferred", "simulated", "authored", "model_generated"]);
const DIRECTIONS = new Set<AiWorldInterestEvidenceDirection>(["support", "counter"]);

export interface ApplyInterestEvidenceResult {
  evidence: AiWorldInterestEvidence;
  preference: AiWorldPreferenceState;
  duplicate: boolean;
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

function normalizeInterestKey(value: string): string {
  return boundedText(value, "interestKey", 200).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizeEvidenceKey(value: string): string {
  return boundedText(value, "evidenceKey", 300);
}

function normalizeRefs(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.length > 50) throw new Error("Interest evidenceRefs cannot exceed 50 entries");
  const normalized = [...new Set(value.map((item) => boundedText(item, "evidenceRef", 500)))];
  return normalized.length === 0 ? undefined : normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function decayPreferenceScore(score: number, elapsedMs: number): number {
  if (!Number.isFinite(score) || score < -1 || score > 1) throw new Error("Preference score must be between -1 and 1");
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Preference decay elapsedMs must be non-negative");
  if (score === 0 || elapsedMs === 0) return roundScore(score);
  const amount = PREFERENCE_DAILY_DECAY * (elapsedMs / DAY_MS);
  const magnitude = Math.max(0, Math.abs(score) - amount);
  return roundScore(Math.sign(score) * magnitude);
}

function assertEvidence(record: AiWorldInterestEvidence): void {
  if (record.world !== "AI_WORLD" || record.source !== "AGENT_LIFE" || !PROVENANCES.has(record.provenance)) {
    throw new Error("Interest evidence has an invalid AI World boundary");
  }
  assertValidRecordBoundary({ world: record.world, provenance: record.provenance });
  if (!record.id || !record.interestKey || !record.evidenceKey || !DIRECTIONS.has(record.direction)) {
    throw new Error("Interest evidence has invalid structured fields");
  }
  if (!Number.isFinite(record.strength) || record.strength < 0 || record.strength > 1) {
    throw new Error("Interest evidence strength must be between 0 and 1");
  }
  if (!record.reason.trim()) throw new Error("Interest evidence reason cannot be empty");
  if (timestamp(record.occurredAt, "interest evidence occurredAt") > timestamp(record.createdAt, "interest evidence createdAt")) {
    throw new Error("Interest evidence cannot occur after its creation time");
  }
}

function assertPreference(record: AiWorldPreferenceState): void {
  if (record.world !== "AI_WORLD" || record.provenance !== "inferred" || record.source !== "AGENT_LIFE") {
    throw new Error("Preference state has an invalid AI World boundary");
  }
  if (!record.id || !record.interestKey || !Number.isFinite(record.score) || record.score < -1 || record.score > 1) {
    throw new Error("Preference state has invalid structured fields");
  }
  if (!Number.isInteger(record.evidenceCount) || record.evidenceCount < 1) {
    throw new Error("Preference state evidenceCount must be positive");
  }
  if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length > MAX_PREFERENCE_EVIDENCE_IDS) {
    throw new Error("Preference state evidence trace is invalid");
  }
  timestamp(record.lastEvidenceAt, "preference lastEvidenceAt");
  const evaluatedAt = timestamp(record.lastEvaluatedAt, "preference lastEvaluatedAt");
  const createdAt = timestamp(record.createdAt, "preference createdAt");
  if (timestamp(record.updatedAt, "preference updatedAt") < createdAt) {
    throw new Error("Preference state updatedAt cannot precede creation");
  }
  if (record.lastReviewedAt !== undefined) {
    const reviewedAt = timestamp(record.lastReviewedAt, "preference lastReviewedAt");
    if (reviewedAt < createdAt || reviewedAt > evaluatedAt) {
      throw new Error("Preference lastReviewedAt is outside the evaluated lifecycle");
    }
  }
  if (record.nextReviewAt !== undefined && timestamp(record.nextReviewAt, "preference nextReviewAt") < evaluatedAt) {
    throw new Error("Preference nextReviewAt cannot precede last evaluation");
  }
}

function preferenceMemory(aiWorld: NonNullable<OurHomeData["aiWorld"]>): {
  continuity: AiWorldContinuityData;
  evidence: AiWorldInterestEvidence[];
  preferences: AiWorldPreferenceState[];
} {
  assertValidAiWorldData(aiWorld);
  const continuity = aiWorld.continuity ?? { experiences: [], notes: [], thoughtThreads: [] };
  const evidence = continuity.interestEvidence ?? [];
  const preferences = continuity.preferences ?? [];

  const evidenceKeys = new Set<string>();
  for (const item of evidence) {
    assertEvidence(item);
    const composite = `${item.interestKey}\u0000${item.evidenceKey}`;
    if (evidenceKeys.has(composite)) throw new Error("Duplicate persisted interest evidence key");
    evidenceKeys.add(composite);
  }
  const preferenceKeys = new Set<string>();
  for (const item of preferences) {
    assertPreference(item);
    if (preferenceKeys.has(item.interestKey)) throw new Error("Duplicate persisted preference state");
    preferenceKeys.add(item.interestKey);
  }
  return { continuity, evidence, preferences };
}

function ensurePreferenceMemory(data: OurHomeData): {
  continuity: AiWorldContinuityData;
  evidence: AiWorldInterestEvidence[];
  preferences: AiWorldPreferenceState[];
} {
  if (!data.aiWorld) throw new Error("AI World must be initialized before preference evidence");
  const current = preferenceMemory(data.aiWorld);
  data.aiWorld.continuity ??= current.continuity;
  data.aiWorld.continuity.interestEvidence ??= [];
  data.aiWorld.continuity.preferences ??= [];
  return {
    continuity: data.aiWorld.continuity,
    evidence: data.aiWorld.continuity.interestEvidence,
    preferences: data.aiWorld.continuity.preferences,
  };
}

function evidenceForInterest(evidence: AiWorldInterestEvidence[], interestKey: string): AiWorldInterestEvidence[] {
  return evidence
    .filter((item) => item.interestKey === interestKey)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
      || left.evidenceKey.localeCompare(right.evidenceKey)
      || left.id.localeCompare(right.id));
}

export function derivePreferenceScore(evidence: AiWorldInterestEvidence[], asOf: string): number {
  const asOfMs = timestamp(asOf, "preference asOf");
  if (evidence.length === 0) return 0;
  const sorted = [...evidence].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
    || left.evidenceKey.localeCompare(right.evidenceKey)
    || left.id.localeCompare(right.id));
  let score = 0;
  let cursor = timestamp(sorted[0]!.occurredAt, "interest evidence occurredAt");

  for (const item of sorted) {
    assertEvidence(item);
    const occurredAt = timestamp(item.occurredAt, "interest evidence occurredAt");
    if (occurredAt > asOfMs) throw new Error("Preference evidence cannot be evaluated before it occurs");
    if (occurredAt > cursor) score = decayPreferenceScore(score, occurredAt - cursor);
    const direction = item.direction === "support" ? 1 : -1;
    const delta = direction * item.strength * MAX_SINGLE_EVIDENCE_DELTA;
    score = roundScore(clamp(score + delta, -1, 1));
    cursor = occurredAt;
  }
  if (asOfMs > cursor) score = decayPreferenceScore(score, asOfMs - cursor);
  return score;
}

function nextReviewAt(asOf: string, score: number): string | undefined {
  if (score === 0) return undefined;
  return new Date(timestamp(asOf, "preference asOf") + PREFERENCE_REVIEW_INTERVAL_MS).toISOString();
}

function derivePreferenceState(
  evidence: AiWorldInterestEvidence[],
  interestKey: string,
  asOf: string,
  existing?: AiWorldPreferenceState,
): AiWorldPreferenceState {
  const sorted = evidenceForInterest(evidence, interestKey);
  if (sorted.length === 0) throw new Error(`Preference has no evidence: ${interestKey}`);
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
    ...(existing?.lastReviewedAt ? { lastReviewedAt: existing.lastReviewedAt } : {}),
    ...(nextReviewAt(asOf, score) ? { nextReviewAt: nextReviewAt(asOf, score) } : {}),
    createdAt: existing?.createdAt ?? asOf,
    updatedAt: asOf,
  };
}

export function listAiWorldInterestEvidence(store: JsonStore, interest?: string): AiWorldInterestEvidence[] {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) return [];
  const memory = preferenceMemory(aiWorld);
  const key = interest === undefined ? undefined : normalizeInterestKey(interest);
  return memory.evidence
    .filter((item) => key === undefined || item.interestKey === key)
    .map((item) => structuredClone(item));
}

export function listAiWorldPreferenceStates(store: JsonStore): AiWorldPreferenceState[] {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) return [];
  return preferenceMemory(aiWorld).preferences
    .slice()
    .sort((left, right) => left.interestKey.localeCompare(right.interestKey))
    .map((item) => structuredClone(item));
}

export async function addAiWorldInterestEvidence(
  store: JsonStore,
  input: {
    interestKey: string;
    evidenceKey: string;
    direction: AiWorldInterestEvidenceDirection;
    strength: number;
    reason: string;
    provenance: AiWorldItemProvenance;
    occurredAt: string;
    evidenceRefs?: string[];
  },
  asOf = new Date().toISOString(),
): Promise<ApplyInterestEvidenceResult> {
  const interestKey = normalizeInterestKey(input.interestKey);
  const evidenceKey = normalizeEvidenceKey(input.evidenceKey);
  if (!DIRECTIONS.has(input.direction)) throw new Error(`Invalid interest evidence direction: ${input.direction}`);
  if (!PROVENANCES.has(input.provenance)) throw new Error(`Invalid interest evidence provenance: ${input.provenance}`);
  assertValidRecordBoundary({ world: "AI_WORLD", provenance: input.provenance });
  if (!Number.isFinite(input.strength) || input.strength < 0 || input.strength > 1) {
    throw new Error("Interest evidence strength must be between 0 and 1");
  }
  const asOfMs = timestamp(asOf, "interest evidence createdAt");
  if (timestamp(input.occurredAt, "interest evidence occurredAt") > asOfMs) {
    throw new Error("Interest evidence cannot occur after its creation time");
  }
  const reason = boundedText(input.reason, "interest evidence reason", 2_000);
  const refs = normalizeRefs(input.evidenceRefs);

  const preflight = store.snapshot().aiWorld;
  if (!preflight) throw new Error("AI World must be initialized before preference evidence");
  const preflightMemory = preferenceMemory(preflight);
  const duplicate = preflightMemory.evidence.find((item) => item.interestKey === interestKey && item.evidenceKey === evidenceKey);
  if (duplicate) {
    const preference = preflightMemory.preferences.find((item) => item.interestKey === interestKey);
    if (preference) return { evidence: structuredClone(duplicate), preference: structuredClone(preference), duplicate: true };
  }

  let result: ApplyInterestEvidenceResult | undefined;
  await store.update((data) => {
    const memory = ensurePreferenceMemory(data);
    const existingEvidence = memory.evidence.find((item) => item.interestKey === interestKey && item.evidenceKey === evidenceKey);
    if (existingEvidence) {
      const existingPreference = memory.preferences.find((item) => item.interestKey === interestKey);
      const rebuilt = existingPreference ?? derivePreferenceState(memory.evidence, interestKey, asOf);
      if (!existingPreference) memory.preferences.push(rebuilt);
      result = { evidence: existingEvidence, preference: rebuilt, duplicate: true };
      return;
    }

    const evidence: AiWorldInterestEvidence = {
      id: randomUUID(),
      world: "AI_WORLD",
      provenance: input.provenance,
      source: "AGENT_LIFE",
      interestKey,
      evidenceKey,
      direction: input.direction,
      strength: input.strength,
      reason,
      occurredAt: input.occurredAt,
      createdAt: asOf,
      ...(refs ? { evidenceRefs: refs } : {}),
    };
    memory.evidence.unshift(evidence);

    const index = memory.preferences.findIndex((item) => item.interestKey === interestKey);
    const existingPreference = index >= 0 ? memory.preferences[index] : undefined;
    const preference = derivePreferenceState(memory.evidence, interestKey, asOf, existingPreference);
    if (index >= 0) memory.preferences[index] = preference;
    else memory.preferences.push(preference);
    result = { evidence, preference, duplicate: false };
  });
  if (!result) throw new Error("Interest evidence was not applied");
  return structuredClone(result);
}

/** Applies only deterministic time decay to preference states whose review time is due. */
export async function reviewDueAiWorldPreferences(
  store: JsonStore,
  asOf = new Date().toISOString(),
): Promise<AiWorldPreferenceState[]> {
  const asOfMs = timestamp(asOf, "preference review asOf");
  const snapshot = store.snapshot().aiWorld;
  if (!snapshot) return [];
  const preflight = preferenceMemory(snapshot);
  const dueKeys = preflight.preferences
    .filter((item) => item.nextReviewAt && timestamp(item.nextReviewAt, "preference nextReviewAt") <= asOfMs)
    .map((item) => item.interestKey);
  if (dueKeys.length === 0) return [];

  const updated: AiWorldPreferenceState[] = [];
  await store.update((data) => {
    const memory = ensurePreferenceMemory(data);
    for (const key of dueKeys) {
      const index = memory.preferences.findIndex((item) => item.interestKey === key);
      if (index < 0) continue;
      const current = memory.preferences[index]!;
      if (!current.nextReviewAt || timestamp(current.nextReviewAt, "preference nextReviewAt") > asOfMs) continue;
      const next = derivePreferenceState(memory.evidence, key, asOf, current);
      next.lastReviewedAt = asOf;
      memory.preferences[index] = next;
      updated.push(next);
    }
  });
  return structuredClone(updated);
}
