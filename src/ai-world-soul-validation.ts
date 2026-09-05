import type { AiWorldContinuityData } from "./types.js";

const MAX_SOUL_EVIDENCE_IDS = 100;
const MAX_SOUL_DELTA = 0.02;
const SOUL_REASONS = new Set(["preference_evidence", "time_decay"] as const);

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001;
}

/**
 * P4.3 persisted-memory guard. It is deliberately independent from the Soul reducer so
 * generic AI World validation can call it without introducing a circular runtime import.
 */
export function assertValidAiWorldSoulMemory(continuity: AiWorldContinuityData): void {
  const evidence = continuity.interestEvidence ?? [];
  const preferences = continuity.preferences ?? [];
  const tendencies = continuity.soulTendencies ?? [];
  const changes = continuity.soulChanges ?? [];

  for (const preference of preferences) {
    const createdAt = timestamp(preference.createdAt, "preference createdAt");
    const evaluatedAt = timestamp(preference.lastEvaluatedAt, "preference lastEvaluatedAt");
    if (preference.lastReviewedAt !== undefined) {
      const reviewedAt = timestamp(preference.lastReviewedAt, "preference lastReviewedAt");
      if (reviewedAt < createdAt || reviewedAt > evaluatedAt) {
        throw new Error("AI World preference lastReviewedAt is outside the evaluated lifecycle");
      }
    }
  }

  if (!Array.isArray(tendencies) || !Array.isArray(changes)) {
    throw new Error("AI World Soul collections must be arrays");
  }

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const preferenceById = new Map(preferences.map((item) => [item.id, item]));
  const tendencyKeys = new Set<string>();
  const tendencyIds = new Set<string>();

  for (const tendency of tendencies) {
    if (tendency.world !== "AI_WORLD" || tendency.provenance !== "inferred" || tendency.source !== "AGENT_LIFE") {
      throw new Error("AI World Soul tendency has an invalid world boundary");
    }
    if (!tendency.id || !tendency.interestKey.trim() || !Number.isFinite(tendency.score)
      || tendency.score < -1 || tendency.score > 1) {
      throw new Error("AI World Soul tendency has invalid structured fields");
    }
    if (!Number.isInteger(tendency.evidenceCount) || tendency.evidenceCount < 3) {
      throw new Error("AI World Soul tendency requires multi-evidence support");
    }
    if (!Array.isArray(tendency.evidenceIds) || tendency.evidenceIds.length < 1
      || tendency.evidenceIds.length > MAX_SOUL_EVIDENCE_IDS
      || tendency.evidenceIds.some((id) => typeof id !== "string" || !id)) {
      throw new Error("AI World Soul tendency evidence trace is invalid");
    }
    if (tendency.evidenceCount < tendency.evidenceIds.length) {
      throw new Error("AI World Soul tendency evidence count is inconsistent");
    }
    for (const evidenceId of tendency.evidenceIds) {
      const item = evidenceById.get(evidenceId);
      if (!item || item.interestKey !== tendency.interestKey) {
        throw new Error("AI World Soul tendency references unrelated evidence");
      }
    }
    const createdAt = timestamp(tendency.createdAt, "Soul tendency createdAt");
    const changedAt = timestamp(tendency.lastChangedAt, "Soul tendency lastChangedAt");
    const updatedAt = timestamp(tendency.updatedAt, "Soul tendency updatedAt");
    if (changedAt < createdAt || updatedAt < changedAt) {
      throw new Error("AI World Soul tendency timestamps are inconsistent");
    }
    if (tendency.lastReviewedAt !== undefined) {
      const reviewedAt = timestamp(tendency.lastReviewedAt, "Soul tendency lastReviewedAt");
      if (reviewedAt < createdAt || reviewedAt > updatedAt) {
        throw new Error("AI World Soul tendency lastReviewedAt is outside its lifecycle");
      }
    }
    if (tendency.nextReviewAt !== undefined && timestamp(tendency.nextReviewAt, "Soul tendency nextReviewAt") < updatedAt) {
      throw new Error("AI World Soul tendency nextReviewAt cannot precede its current state");
    }
    if (tendencyKeys.has(tendency.interestKey) || tendencyIds.has(tendency.id)) {
      throw new Error("Duplicate AI World Soul tendency");
    }
    tendencyKeys.add(tendency.interestKey);
    tendencyIds.add(tendency.id);
  }

  const changeIds = new Set<string>();
  const preferenceBasisKeys = new Set<string>();
  for (const change of changes) {
    if (change.world !== "AI_WORLD" || change.provenance !== "inferred" || change.source !== "AGENT_LIFE") {
      throw new Error("AI World Soul change has an invalid world boundary");
    }
    if (!change.id || !change.interestKey.trim() || !SOUL_REASONS.has(change.reason)) {
      throw new Error("AI World Soul change has invalid structured fields");
    }
    if (![change.beforeScore, change.afterScore, change.delta].every(Number.isFinite)
      || change.beforeScore < -1 || change.beforeScore > 1
      || change.afterScore < -1 || change.afterScore > 1
      || !closeEnough(change.afterScore - change.beforeScore, change.delta)) {
      throw new Error("AI World Soul change score audit is inconsistent");
    }
    timestamp(change.occurredAt, "Soul change occurredAt");
    if (changeIds.has(change.id)) throw new Error("Duplicate AI World Soul change id");
    changeIds.add(change.id);

    if (change.reason === "preference_evidence") {
      if (Math.abs(change.delta) > MAX_SOUL_DELTA + 0.000001) {
        throw new Error("AI World Soul preference change exceeds the hard delta cap");
      }
      if (!change.basisPreferenceId || !change.basisKey || !Array.isArray(change.basisEvidenceIds)
        || change.basisEvidenceIds.length < 1 || change.basisEvidenceIds.length > MAX_SOUL_EVIDENCE_IDS) {
        throw new Error("AI World Soul preference change is missing its evidence basis");
      }
      const preference = preferenceById.get(change.basisPreferenceId);
      if (!preference || preference.interestKey !== change.interestKey) {
        throw new Error("AI World Soul change references an unrelated preference");
      }
      for (const evidenceId of change.basisEvidenceIds) {
        const item = evidenceById.get(evidenceId);
        if (!item || item.interestKey !== change.interestKey) {
          throw new Error("AI World Soul change references unrelated evidence");
        }
      }
      if (preferenceBasisKeys.has(change.basisKey)) {
        throw new Error("Duplicate AI World Soul preference basis");
      }
      preferenceBasisKeys.add(change.basisKey);
    } else {
      if (Math.abs(change.afterScore) > Math.abs(change.beforeScore) + 0.000001
        || (change.beforeScore !== 0 && change.afterScore !== 0 && Math.sign(change.afterScore) !== Math.sign(change.beforeScore))) {
        throw new Error("AI World Soul decay must move toward neutral");
      }
      if (change.basisPreferenceId !== undefined || change.basisKey !== undefined || change.basisEvidenceIds !== undefined) {
        throw new Error("AI World Soul decay cannot carry a preference reinforcement basis");
      }
    }
  }
}
