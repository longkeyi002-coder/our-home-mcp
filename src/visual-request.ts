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
export const VISUAL_ACTIVE_USE_FRESHNESS_MS = 7 * 60_000;
export const VISUAL_TRANSITION_REASON = "app_transition";

function time(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function stringMetadata(item: LifeObservation, key: string): string | null {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanMetadata(item: LifeObservation, key: string): boolean | null {
  const value = item.metadata?.[key];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function latestScreenState(
  item: LifeObservation,
  observations: LifeObservation[],
  observedAtMs: number,
): { interactive: boolean; unlocked: boolean } | null {
  const directInteractive = booleanMetadata(item, "screenInteractive");
  const directUnlocked = booleanMetadata(item, "unlocked");
  if (directInteractive != null && directUnlocked != null) {
    return { interactive: directInteractive, unlocked: directUnlocked };
  }

  const latest = observations
    .filter(isEarthEvidence)
    .filter((candidate) => candidate.deviceId === item.deviceId && candidate.kind === "presence_screen")
    .map((candidate) => ({
      candidate,
      at: time(candidate.observedAt),
      interactive: booleanMetadata(candidate, "interactive"),
      unlocked: booleanMetadata(candidate, "unlocked"),
    }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= observedAtMs)
    .filter((entry) => entry.interactive != null && entry.unlocked != null)
    .sort((left, right) => right.at - left.at)[0];

  return latest
    ? { interactive: latest.interactive!, unlocked: latest.unlocked! }
    : null;
}

function transitionOpportunity(
  transition: LifeObservation,
  observations: LifeObservation[],
): VisualOpportunity | null {
  if (!transition.deviceId) return null;
  if (booleanMetadata(transition, "identityHidden") === true) return null;

  const packageName = stringMetadata(transition, "toPackage") ?? transition.label?.trim();
  const observedAtMs = time(transition.observedAt);
  if (!packageName || packageName === "private_app_active" || !Number.isFinite(observedAtMs)) return null;

  const screen = latestScreenState(transition, observations, observedAtMs);
  if (!screen?.interactive || !screen.unlocked) return null;

  const startedAt = stringMetadata(transition, "startedAt");
  const startedAtMs = startedAt ? time(startedAt) : observedAtMs;
  const lastInteractionAt = stringMetadata(transition, "lastInteractionAt");
  const lastInteractionAtMs = lastInteractionAt ? time(lastInteractionAt) : observedAtMs;
  if (
    !Number.isFinite(startedAtMs)
    || startedAtMs > observedAtMs
    || !Number.isFinite(lastInteractionAtMs)
    || lastInteractionAtMs > observedAtMs
    || observedAtMs - lastInteractionAtMs > VISUAL_ACTIVE_USE_FRESHNESS_MS
  ) {
    return null;
  }

  const budget = decideVisualBudget(observations, transition.deviceId, observedAtMs);
  if (!budget.allowed) return null;

  return {
    deviceId: transition.deviceId,
    packageName,
    sessionId: `${packageName}:${startedAtMs}`,
    curiosityReason: VISUAL_TRANSITION_REASON,
    observedAt: new Date(observedAtMs).toISOString(),
    expiresAt: new Date(observedAtMs + VISUAL_OPPORTUNITY_TTL_MS).toISOString(),
  };
}

function dwellOpportunity(
  dwell: LifeObservation,
  observations: LifeObservation[],
): VisualOpportunity | null {
  if (!dwell.deviceId) return null;
  const packageName = stringMetadata(dwell, "packageName") ?? dwell.label?.trim();
  const startedAt = stringMetadata(dwell, "startedAt");
  const durationMs = Number(stringMetadata(dwell, "durationMs"));
  const screenInteractive = booleanMetadata(dwell, "screenInteractive");
  const unlocked = booleanMetadata(dwell, "unlocked");
  const lastInteractionAt = stringMetadata(dwell, "lastInteractionAt");
  const observedAtMs = time(dwell.observedAt);
  if (
    !packageName
    || !startedAt
    || !Number.isFinite(durationMs)
    || durationMs < 0
    || !Number.isFinite(observedAtMs)
    || screenInteractive !== true
    || unlocked !== true
    || !lastInteractionAt
  ) {
    return null;
  }
  const startedAtMs = time(startedAt);
  const lastInteractionAtMs = time(lastInteractionAt);
  if (
    !Number.isFinite(startedAtMs)
    || startedAtMs > observedAtMs
    || !Number.isFinite(lastInteractionAtMs)
    || lastInteractionAtMs > observedAtMs
    || observedAtMs - lastInteractionAtMs > VISUAL_ACTIVE_USE_FRESHNESS_MS
  ) {
    return null;
  }

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
    screenUsable: screenInteractive && unlocked,
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
 * Cheap deterministic eligibility gate. An active App transition may immediately become a
 * visual opportunity; a sustained session may also become one at a sparse dwell milestone.
 * Neither path authorizes a screenshot. Brain still chooses ignore/request_visual, and Android
 * remains the final exact-session/privacy veto.
 */
export function deriveVisualOpportunity(
  observation: LifeObservation,
  observations: LifeObservation[],
): VisualOpportunity | null {
  if (!isEarthEvidence(observation)) return null;
  if (observation.kind === "presence_app_transition") {
    return transitionOpportunity(observation, observations);
  }
  if (observation.kind === "presence_app_dwell") {
    return dwellOpportunity(observation, observations);
  }
  return null;
}

/**
 * Backward-compatible direct request derivation retained for isolated policy tests and callers
 * that have not moved to Brain-directed observation yet. Runtime HTTP no longer uses it to
 * authorize capture; production flow converts an approved visual opportunity into a request.
 */
export function deriveVisualRequest(
  observation: LifeObservation,
  observations: LifeObservation[],
): VisualRequest | null {
  const opportunity = deriveVisualOpportunity(observation, observations);
  if (!opportunity) return null;
  const stage = stringMetadata(observation, "stage") ?? "x";
  const observedAtMs = Date.parse(opportunity.observedAt);
  const startedAtMs = Number(opportunity.sessionId.slice(opportunity.packageName.length + 1));
  const requestId = `visual:${observation.deviceId ?? "phone"}:${startedAtMs}:${stage}:${opportunity.curiosityReason}`;
  return {
    requestId,
    packageName: opportunity.packageName,
    sessionId: opportunity.sessionId,
    reason: opportunity.curiosityReason,
    issuedAt: opportunity.observedAt,
    expiresAt: new Date(observedAtMs + VISUAL_REQUEST_TTL_MS).toISOString(),
  };
}
