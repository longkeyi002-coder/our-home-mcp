import { decideCuriosity, type ContextUnderstandingState } from "./curiosity.js";
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

export const VISUAL_REQUEST_TTL_MS = 2 * 60_000;
const DECLARATION_FRESH_MS = 2 * 60 * 60_000;

function time(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function stringMetadata(item: LifeObservation, key: string): string | null {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameDevice(item: LifeObservation, deviceId: string | undefined): boolean {
  return Boolean(deviceId) && item.deviceId === deviceId;
}

function understandingFor(
  observations: LifeObservation[],
  deviceId: string | undefined,
  sessionId: string,
  asOfMs: number,
): { understanding: ContextUnderstandingState; lastVisualAtMs: number | null } {
  const latestVisual = observations
    .filter((item) => sameDevice(item, deviceId))
    .filter((item) => item.kind === "visual_observation_summary" && stringMetadata(item, "sessionId") === sessionId)
    .map((item) => ({ item, at: time(item.observedAt) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= asOfMs)
    .sort((left, right) => right.at - left.at)[0];

  const declarations = observations
    .filter((item) => item.source === "user" && item.confidence === "declared")
    .filter((item) => item.kind === "manual_status" || item.kind === "note")
    .map((item) => ({ item, at: time(item.observedAt) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= asOfMs && asOfMs - entry.at <= DECLARATION_FRESH_MS)
    .sort((left, right) => right.at - left.at);

  const latestDeclaration = declarations[0]?.item;
  const declarationHasActivity = typeof latestDeclaration?.metadata?.activity === "string"
    && String(latestDeclaration.metadata.activity).trim().length > 0;

  if (latestVisual) return { understanding: "KNOWN", lastVisualAtMs: latestVisual.at };
  if (declarationHasActivity) return { understanding: "KNOWN", lastVisualAtMs: null };
  if (latestDeclaration) return { understanding: "PARTIAL", lastVisualAtMs: null };
  return { understanding: "UNKNOWN", lastVisualAtMs: null };
}

/**
 * OH-44/OH-64: only sparse dwell milestones can create a visual request. The request is
 * a short-lived proposal bound to one exact foreground App session. Android still owns
 * final privacy/capture authority. Runtime also applies a rolling per-device visual budget
 * so curiosity cannot become frequent screenshot/Vision activity across App sessions.
 */
export function deriveVisualRequest(
  dwell: LifeObservation,
  observations: LifeObservation[],
): VisualRequest | null {
  if (dwell.kind !== "presence_app_dwell") return null;
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
  const context = understandingFor(observations, dwell.deviceId, sessionId, observedAtMs);
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

  const stage = stringMetadata(dwell, "stage") ?? "x";
  const requestId = `visual:${dwell.deviceId ?? "phone"}:${startedAtMs}:${stage}:${decision.reason}`;
  return {
    requestId,
    packageName,
    sessionId,
    reason: decision.reason,
    issuedAt: new Date(observedAtMs).toISOString(),
    expiresAt: new Date(observedAtMs + VISUAL_REQUEST_TTL_MS).toISOString(),
  };
}
