import { createHash, randomUUID } from "node:crypto";
import { assertValidAiWorldData } from "./ai-world.js";
import type { JsonStore } from "./store.js";
import type {
  AiWorldContinuityData,
  AiWorldInterestEvidence,
  AiWorldPreferenceState,
  AiWorldSoulChange,
  AiWorldSoulTendency,
  OurHomeData,
} from "./types.js";

export const MIN_SOUL_EVIDENCE_COUNT = 3;
export const MIN_REVIEWED_PREFERENCE_MAGNITUDE = 0.08;
export const MAX_SOUL_DELTA = 0.02;
export const SOUL_DAILY_DECAY = 0.0002;
export const SOUL_REVIEW_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_SOUL_EVIDENCE_IDS = 100;

const DAY_MS = 24 * 60 * 60 * 1_000;

export type SoulPreferenceApplyReason =
  | "applied"
  | "preference_not_found"
  | "insufficient_evidence"
  | "preference_not_reviewed"
  | "review_predates_latest_evidence"
  | "preference_too_weak"
  | "duplicate_basis"
  | "no_change";

export interface SoulPreferenceApplyResult {
  applied: boolean;
  reason: SoulPreferenceApplyReason;
  tendency?: AiWorldSoulTendency;
  change?: AiWorldSoulChange;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function normalizeInterestKey(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  if (!trimmed) throw new Error("Soul interestKey cannot be empty");
  if (trimmed.length > 200) throw new Error("Soul interestKey exceeds 200 characters");
  return trimmed;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function decaySoulScore(score: number, elapsedMs: number): number {
  if (!Number.isFinite(score) || score < -1 || score > 1) throw new Error("Soul score must be between -1 and 1");
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Soul decay elapsedMs must be non-negative");
  if (score === 0 || elapsedMs === 0) return roundScore(score);
  const decay = SOUL_DAILY_DECAY * (elapsedMs / DAY_MS);
  const magnitude = Math.max(0, Math.abs(score) - decay);
  return roundScore(Math.sign(score) * magnitude);
}

function basisEvidence(
  continuity: AiWorldContinuityData,
  preference: AiWorldPreferenceState,
): AiWorldInterestEvidence[] {
  const evidence = (continuity.interestEvidence ?? [])
    .filter((item) => item.interestKey === preference.interestKey)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
      || left.evidenceKey.localeCompare(right.evidenceKey)
      || left.id.localeCompare(right.id));
  if (evidence.length !== preference.evidenceCount) {
    throw new Error("Soul preference basis evidenceCount is inconsistent");
  }
  return evidence;
}

function basisKey(interestKey: string, evidence: AiWorldInterestEvidence[]): string {
  const hash = createHash("sha256");
  hash.update(interestKey);
  hash.update("\0");
  for (const item of evidence) {
    hash.update(item.id);
    hash.update("\0");
  }
  return `soul-basis:${hash.digest("hex")}`;
}

function soulMemory(aiWorld: NonNullable<OurHomeData["aiWorld"]>): {
  continuity: AiWorldContinuityData;
  preferences: AiWorldPreferenceState[];
  tendencies: AiWorldSoulTendency[];
  changes: AiWorldSoulChange[];
} {
  assertValidAiWorldData(aiWorld);
  const continuity = aiWorld.continuity ?? { experiences: [], notes: [], thoughtThreads: [] };
  return {
    continuity,
    preferences: continuity.preferences ?? [],
    tendencies: continuity.soulTendencies ?? [],
    changes: continuity.soulChanges ?? [],
  };
}

function ensureSoulMemory(data: OurHomeData): ReturnType<typeof soulMemory> {
  if (!data.aiWorld) throw new Error("AI World must be initialized before Soul changes");
  const current = soulMemory(data.aiWorld);
  data.aiWorld.continuity ??= current.continuity;
  data.aiWorld.continuity.soulTendencies ??= [];
  data.aiWorld.continuity.soulChanges ??= [];
  return {
    continuity: data.aiWorld.continuity,
    preferences: data.aiWorld.continuity.preferences ?? [],
    tendencies: data.aiWorld.continuity.soulTendencies,
    changes: data.aiWorld.continuity.soulChanges,
  };
}

function nextReviewAt(asOf: string, score: number): string | undefined {
  if (score === 0) return undefined;
  return new Date(timestamp(asOf, "Soul review anchor") + SOUL_REVIEW_INTERVAL_MS).toISOString();
}

export function listAiWorldSoulTendencies(store: JsonStore): AiWorldSoulTendency[] {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) return [];
  return soulMemory(aiWorld).tendencies
    .slice()
    .sort((left, right) => left.interestKey.localeCompare(right.interestKey))
    .map((item) => structuredClone(item));
}

export function listAiWorldSoulChanges(store: JsonStore, interest?: string): AiWorldSoulChange[] {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) return [];
  const key = interest === undefined ? undefined : normalizeInterestKey(interest);
  return soulMemory(aiWorld).changes
    .filter((item) => key === undefined || item.interestKey === key)
    .map((item) => structuredClone(item));
}

/**
 * Tries to promote one reviewed temporary preference into the slower Soul layer.
 * Callers cannot supply a score or delta; Runtime derives every numeric change locally.
 */
export async function applyReviewedPreferenceToSoul(
  store: JsonStore,
  interest: string,
  asOf = new Date().toISOString(),
): Promise<SoulPreferenceApplyResult> {
  const asOfMs = timestamp(asOf, "Soul application asOf");
  const interestKey = normalizeInterestKey(interest);
  const snapshot = store.snapshot().aiWorld;
  if (!snapshot) return { applied: false, reason: "preference_not_found" };
  const preflight = soulMemory(snapshot);
  const preference = preflight.preferences.find((item) => item.interestKey === interestKey);
  if (!preference) return { applied: false, reason: "preference_not_found" };
  if (preference.evidenceCount < MIN_SOUL_EVIDENCE_COUNT) return { applied: false, reason: "insufficient_evidence" };
  if (!preference.lastReviewedAt) return { applied: false, reason: "preference_not_reviewed" };
  const preflightReviewedAt = timestamp(preference.lastReviewedAt, "preference lastReviewedAt");
  if (preflightReviewedAt < timestamp(preference.lastEvidenceAt, "preference lastEvidenceAt")) {
    return { applied: false, reason: "review_predates_latest_evidence" };
  }
  if (asOfMs < preflightReviewedAt) throw new Error("Soul application cannot precede preference review");
  if (Math.abs(preference.score) < MIN_REVIEWED_PREFERENCE_MAGNITUDE) {
    return { applied: false, reason: "preference_too_weak" };
  }
  const preflightEvidence = basisEvidence(preflight.continuity, preference);
  const preflightBasisKey = basisKey(interestKey, preflightEvidence);
  if (preflight.changes.some((item) => item.reason === "preference_evidence" && item.basisKey === preflightBasisKey)) {
    return { applied: false, reason: "duplicate_basis" };
  }

  let result: SoulPreferenceApplyResult | undefined;
  await store.update((data) => {
    const memory = ensureSoulMemory(data);
    const currentPreference = memory.preferences.find((item) => item.interestKey === interestKey);
    if (!currentPreference) {
      result = { applied: false, reason: "preference_not_found" };
      return;
    }
    if (currentPreference.evidenceCount < MIN_SOUL_EVIDENCE_COUNT) {
      result = { applied: false, reason: "insufficient_evidence" };
      return;
    }
    if (!currentPreference.lastReviewedAt) {
      result = { applied: false, reason: "preference_not_reviewed" };
      return;
    }
    const reviewedAt = timestamp(currentPreference.lastReviewedAt, "preference lastReviewedAt");
    if (reviewedAt < timestamp(currentPreference.lastEvidenceAt, "preference lastEvidenceAt")) {
      result = { applied: false, reason: "review_predates_latest_evidence" };
      return;
    }
    if (asOfMs < reviewedAt) throw new Error("Soul application cannot precede preference review");
    if (Math.abs(currentPreference.score) < MIN_REVIEWED_PREFERENCE_MAGNITUDE) {
      result = { applied: false, reason: "preference_too_weak" };
      return;
    }

    const evidence = basisEvidence(memory.continuity, currentPreference);
    const currentBasisKey = basisKey(interestKey, evidence);
    if (memory.changes.some((item) => item.reason === "preference_evidence" && item.basisKey === currentBasisKey)) {
      result = { applied: false, reason: "duplicate_basis" };
      return;
    }

    const tendencyIndex = memory.tendencies.findIndex((item) => item.interestKey === interestKey);
    const existing = tendencyIndex >= 0 ? memory.tendencies[tendencyIndex] : undefined;
    if (existing && asOfMs < timestamp(existing.updatedAt, "Soul tendency updatedAt")) {
      throw new Error("Soul application cannot precede the current tendency state");
    }
    const beforeScore = existing?.score ?? 0;
    const requestedDelta = currentPreference.score - beforeScore;
    const delta = roundScore(clamp(requestedDelta, -MAX_SOUL_DELTA, MAX_SOUL_DELTA));
    if (delta === 0) {
      result = { applied: false, reason: "no_change", ...(existing ? { tendency: structuredClone(existing) } : {}) };
      return;
    }
    const afterScore = roundScore(clamp(beforeScore + delta, -1, 1));
    const boundedEvidenceIds = evidence.slice(-MAX_SOUL_EVIDENCE_IDS).map((item) => item.id);
    const tendency: AiWorldSoulTendency = {
      id: existing?.id ?? randomUUID(),
      world: "AI_WORLD",
      provenance: "inferred",
      source: "AGENT_LIFE",
      interestKey,
      score: afterScore,
      evidenceCount: evidence.length,
      evidenceIds: boundedEvidenceIds,
      lastChangedAt: asOf,
      ...(existing?.lastReviewedAt ? { lastReviewedAt: existing.lastReviewedAt } : {}),
      ...(nextReviewAt(asOf, afterScore) ? { nextReviewAt: nextReviewAt(asOf, afterScore) } : {}),
      createdAt: existing?.createdAt ?? asOf,
      updatedAt: asOf,
    };
    const change: AiWorldSoulChange = {
      id: randomUUID(),
      world: "AI_WORLD",
      provenance: "inferred",
      source: "AGENT_LIFE",
      interestKey,
      reason: "preference_evidence",
      beforeScore,
      afterScore,
      delta: roundScore(afterScore - beforeScore),
      occurredAt: asOf,
      basisPreferenceId: currentPreference.id,
      basisKey: currentBasisKey,
      basisEvidenceIds: boundedEvidenceIds,
    };

    if (tendencyIndex >= 0) memory.tendencies[tendencyIndex] = tendency;
    else memory.tendencies.push(tendency);
    memory.changes.unshift(change);
    result = { applied: true, reason: "applied", tendency, change };
  });

  if (!result) throw new Error("Soul preference application did not resolve");
  return structuredClone(result);
}

/** Applies slow deterministic Soul decay only when a tendency review is due. */
export async function reviewDueAiWorldSoul(
  store: JsonStore,
  asOf = new Date().toISOString(),
): Promise<AiWorldSoulTendency[]> {
  const asOfMs = timestamp(asOf, "Soul review asOf");
  const snapshot = store.snapshot().aiWorld;
  if (!snapshot) return [];
  const preflight = soulMemory(snapshot);
  const dueKeys = preflight.tendencies
    .filter((item) => item.nextReviewAt && timestamp(item.nextReviewAt, "Soul nextReviewAt") <= asOfMs)
    .map((item) => item.interestKey);
  if (dueKeys.length === 0) return [];

  const reviewed: AiWorldSoulTendency[] = [];
  await store.update((data) => {
    const memory = ensureSoulMemory(data);
    for (const key of dueKeys) {
      const index = memory.tendencies.findIndex((item) => item.interestKey === key);
      if (index < 0) continue;
      const current = memory.tendencies[index]!;
      if (!current.nextReviewAt || timestamp(current.nextReviewAt, "Soul nextReviewAt") > asOfMs) continue;

      const anchor = current.lastReviewedAt ?? current.lastChangedAt;
      const beforeScore = current.score;
      const afterScore = decaySoulScore(beforeScore, asOfMs - timestamp(anchor, "Soul decay anchor"));
      const next: AiWorldSoulTendency = {
        ...current,
        score: afterScore,
        lastReviewedAt: asOf,
        ...(nextReviewAt(asOf, afterScore) ? { nextReviewAt: nextReviewAt(asOf, afterScore) } : { nextReviewAt: undefined }),
        updatedAt: asOf,
      };
      if (afterScore !== beforeScore) {
        const change: AiWorldSoulChange = {
          id: randomUUID(),
          world: "AI_WORLD",
          provenance: "inferred",
          source: "AGENT_LIFE",
          interestKey: key,
          reason: "time_decay",
          beforeScore,
          afterScore,
          delta: roundScore(afterScore - beforeScore),
          occurredAt: asOf,
        };
        memory.changes.unshift(change);
      }
      memory.tendencies[index] = next;
      reviewed.push(next);
    }
  });
  return structuredClone(reviewed);
}
