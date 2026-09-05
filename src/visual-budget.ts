import type { LifeObservation } from "./types.js";

export type VisualBudgetReason =
  | "within_budget"
  | "hourly_budget_exhausted"
  | "daily_budget_exhausted";

export interface VisualBudgetDecision {
  allowed: boolean;
  reason: VisualBudgetReason;
  usedInHour: number;
  usedInDay: number;
  nextAvailableAtMs?: number;
}

const MINUTE = 60_000;
export const VISUAL_BUDGET_HOURLY_WINDOW_MS = 60 * MINUTE;
export const VISUAL_BUDGET_DAILY_WINDOW_MS = 24 * 60 * MINUTE;
export const VISUAL_BUDGET_HOURLY_LIMIT = 3;
export const VISUAL_BUDGET_DAILY_LIMIT = 12;

function observedTime(item: LifeObservation): number {
  const parsed = Date.parse(item.observedAt);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function successfulCaptureTimes(
  observations: LifeObservation[],
  deviceId: string | undefined,
  nowMs: number,
): number[] {
  if (!deviceId) return [];
  return observations
    .filter((item) => item.deviceId === deviceId)
    .filter((item) => item.kind === "visual_policy_audit")
    .filter((item) => item.metadata?.action === "capture_succeeded")
    .filter((item) => isTrue(item.metadata?.allowed))
    .map(observedTime)
    .filter((at) => Number.isFinite(at) && at <= nowMs)
    .sort((left, right) => left - right);
}

/**
 * OH-44/OH-64: deterministic rolling visual budget. Only a real successful Android
 * screenshot consumes budget. Guard denials and capture failures do not. This limits
 * screenshot/Vision activity independently of the per-session curiosity cooldown.
 */
export function decideVisualBudget(
  observations: LifeObservation[],
  deviceId: string | undefined,
  nowMs: number,
): VisualBudgetDecision {
  const captures = successfulCaptureTimes(observations, deviceId, nowMs);
  const hourly = captures.filter((at) => at > nowMs - VISUAL_BUDGET_HOURLY_WINDOW_MS);
  const daily = captures.filter((at) => at > nowMs - VISUAL_BUDGET_DAILY_WINDOW_MS);

  if (daily.length >= VISUAL_BUDGET_DAILY_LIMIT) {
    return {
      allowed: false,
      reason: "daily_budget_exhausted",
      usedInHour: hourly.length,
      usedInDay: daily.length,
      nextAvailableAtMs: daily[0] + VISUAL_BUDGET_DAILY_WINDOW_MS,
    };
  }

  if (hourly.length >= VISUAL_BUDGET_HOURLY_LIMIT) {
    return {
      allowed: false,
      reason: "hourly_budget_exhausted",
      usedInHour: hourly.length,
      usedInDay: daily.length,
      nextAvailableAtMs: hourly[0] + VISUAL_BUDGET_HOURLY_WINDOW_MS,
    };
  }

  return {
    allowed: true,
    reason: "within_budget",
    usedInHour: hourly.length,
    usedInDay: daily.length,
  };
}
