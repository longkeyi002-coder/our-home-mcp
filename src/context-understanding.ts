import type { LifeObservation } from "./types.js";

export type ContextUnderstandingState = "UNKNOWN" | "PARTIAL" | "KNOWN" | "CONFLICT" | "STALE";

export interface ContextUnderstandingResult {
  understanding: ContextUnderstandingState;
  lastVisualAtMs: number | null;
  declaredActivity: string | null;
  visualActivity: string | null;
  visualConfidence: number | null;
}

const MINUTE = 60_000;
export const CONTEXT_DECLARATION_FRESH_MS = 2 * 60 * MINUTE;
export const CONTEXT_VISUAL_FRESH_MS = 60 * MINUTE;
export const CONTEXT_MIN_RELIABLE_VISUAL_CONFIDENCE = 0.6;

function time(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function metadataString(item: LifeObservation, key: string): string | null {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedActivity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "other") return null;
  return normalized;
}

function visualConfidence(item: LifeObservation): number | null {
  const value = item.metadata?.confidence;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * OH-43/OH-44: fuse provenance-bearing user declarations and visual summaries into a
 * deterministic context state. Presence supplies the current App/session boundary; this
 * function never invents semantic activity from a package name alone.
 */
export function deriveContextUnderstanding(
  observations: LifeObservation[],
  deviceId: string | undefined,
  sessionId: string,
  asOfMs: number,
): ContextUnderstandingResult {
  const latestVisual = observations
    .filter((item) => Boolean(deviceId) && item.deviceId === deviceId)
    .filter((item) => item.kind === "visual_observation_summary")
    .filter((item) => metadataString(item, "sessionId") === sessionId)
    .map((item) => ({ item, at: time(item.observedAt) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= asOfMs)
    .sort((left, right) => right.at - left.at)[0];

  const latestDeclaration = observations
    .filter((item) => item.source === "user" && item.confidence === "declared")
    .filter((item) => item.kind === "manual_status" || item.kind === "note")
    .map((item) => ({ item, at: time(item.observedAt) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= asOfMs)
    .filter((entry) => asOfMs - entry.at <= CONTEXT_DECLARATION_FRESH_MS)
    .sort((left, right) => right.at - left.at)[0];

  const lastVisualAtMs = latestVisual?.at ?? null;
  const declaredActivity = normalizedActivity(latestDeclaration?.item.metadata?.activity);
  const visualActivity = normalizedActivity(latestVisual?.item.metadata?.activity);
  const confidence = latestVisual ? visualConfidence(latestVisual.item) : null;
  const visualFresh = latestVisual != null && asOfMs - latestVisual.at <= CONTEXT_VISUAL_FRESH_MS;
  const visualReliable = visualFresh
    && visualActivity != null
    && confidence != null
    && confidence >= CONTEXT_MIN_RELIABLE_VISUAL_CONFIDENCE;

  if (visualReliable) {
    if (declaredActivity != null && declaredActivity !== visualActivity) {
      return {
        understanding: "CONFLICT",
        lastVisualAtMs,
        declaredActivity,
        visualActivity,
        visualConfidence: confidence,
      };
    }
    return {
      understanding: "KNOWN",
      lastVisualAtMs,
      declaredActivity,
      visualActivity,
      visualConfidence: confidence,
    };
  }

  if (declaredActivity != null) {
    return {
      understanding: "KNOWN",
      lastVisualAtMs,
      declaredActivity,
      visualActivity,
      visualConfidence: confidence,
    };
  }

  if (latestVisual != null && !visualFresh) {
    return {
      understanding: "STALE",
      lastVisualAtMs,
      declaredActivity,
      visualActivity,
      visualConfidence: confidence,
    };
  }

  if (latestVisual != null || latestDeclaration != null) {
    return {
      understanding: "PARTIAL",
      lastVisualAtMs,
      declaredActivity,
      visualActivity,
      visualConfidence: confidence,
    };
  }

  return {
    understanding: "UNKNOWN",
    lastVisualAtMs: null,
    declaredActivity: null,
    visualActivity: null,
    visualConfidence: null,
  };
}
