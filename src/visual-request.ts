import { isEarthEvidence } from "./world-boundary.js";
import { deriveContextUnderstanding } from "./context-understanding.js";
import { decideCuriosity } from "./curiosity.js";
import { decideVisualBudget } from "./visual-budget.js";
import type { LifeObservation } from "./types.js";

export interface VisualRequest {
  requestId: string;
  packageName: string;
  sessionId: string;
  reason: string;
  issuedAt: string;
  expiresAt: string;
}

export interface VisualOpportunity {
  deviceId: string;
  packageName: string;
  sessionId: string;
  curiosityReason: string;
  observedAt: string;
  expiresAt: string;
}

export const VISUAL_REQUEST_TTL_MS = 2 * 60_000;
export const VISUAL_OPPORTUNITY_TTL_MS = 5 * 60_000;

function time(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function stringMetadata(item: LifeObservation, key: string): string | null {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Cheap deterministic eligibility gate. This answers only whether the current sparse dwell
 * milestone is worth asking the Brain about. It does not authorize a screenshot.
 */
export function deriveVisualOpportunity(
  dwell: LifeObservation,
  observations: LifeObservation[],
): VisualOpportunity | null {
  if (!isEarthEvidence(dwell)) return null;
  if (dwell.kind !== "presence_app_dwell" || !dwell.deviceId) return null;
  const packageName = stringMetadata(dwell, "packageName") ?? dwell.label?.trim();
  const startedAt = stringMetadata(dwell, "startedAt");
  const durationMs = Number(stringMetadata(dwell, "durationMs"));
  const observedAtMs = time(dwell.observedAt);
  if (!packageName || !startedAt || !Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(observedAtMs)) {
    return null;
  }
  const startedAtMs = time(startedAt);
  if (!Number.isFinite(startedAtMs) || startedAtMs > observedAtMs) return null;

  const sessionId = `${packageName}:${startedAtMs}`;
  const context = deriveContextUnderstanding(
    observations,
    dwell.deviceId,
    sessionId,
    observedAtMs,
  );
  const decision = decideCuriosity({
    understanding: context.understanding,
    dwellMs: durationMs,
    screenUsable: true,
    nowMs: observedAtMs,
    lastVisualAtMs: context.lastVisualAtMs,
  });
  if (!decision.requestVisual) return null;

  const budget = decideVisualBudget(observations, dwell.deviceId, observedAtMs);
  if (!budget.allowed) return null;

  return {
    deviceId: dwell.deviceId,
    packageName,
    sessionId,
    curiosityReason: decision.reason,
    observedAt: new Date(observedAtMs).toISOString(),
    expiresAt: new Date(observedAtMs + VISUAL_OPPORTUNITY_TTL_MS).toISOString(),
  };
}

/**
 * Backward-compatible direct request derivation retained for isolated policy tests and callers
 * that have not moved to Brain-directed observation yet. Runtime HTTP no longer uses it to
 * authorize capture; production flow converts an approved visual opportunity into a request.
 */
export function deriveVisualRequest(
  dwell: LifeObservation,
  observations: LifeObservation[],
): VisualRequest | null {
  const opportunity = deriveVisualOpportunity(dwell, observations);
  if (!opportunity) return null;
  const stage = stringMetadata(dwell, "stage") ?? "x";
  const observedAtMs = Date.parse(opportunity.observedAt);
  const startedAtMs = Number(opportunity.sessionId.slice(opportunity.packageName.length + 1));
  const requestId = `visual:${dwell.deviceId ?? "phone"}:${startedAtMs}:${stage}:${opportunity.curiosityReason}`;
  return {
    requestId,
    packageName: opportunity.packageName,
    sessionId: opportunity.sessionId,
    reason: opportunity.curiosityReason,
    issuedAt: opportunity.observedAt,
    expiresAt: new Date(observedAtMs + VISUAL_REQUEST_TTL_MS).toISOString(),
  };
}
