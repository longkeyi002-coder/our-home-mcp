import { deriveLifeState } from "./life-state.js";
import type { LifeObservation, ProactiveCandidate, WakeEvent } from "./types.js";
import { decideQuietHours, type QuietHoursPolicy } from "./quiet-hours.js";
import { VISUAL_RESULT_WAKE_TTL_MS } from "./visual-result-wake.js";

export const CARE_MESSAGE_COOLDOWN_MS = 60 * 60_000;

export type CareDeliveryReason =
  | "not_long_dwell"
  | "current_session"
  | "stale_long_dwell"
  | "stale_visual_result"
  | "care_message_cooldown"
  | "quiet_hours";

export interface CareDeliveryDecision {
  deliver: boolean;
  reason: CareDeliveryReason;
  nextAvailableAt?: string;
}

export interface CareDeliverySnapshot {
  observations: LifeObservation[];
  wakeEvents: WakeEvent[];
  proactiveQueue: ProactiveCandidate[];
}

function linkedWake(candidate: ProactiveCandidate, wakeEvents: WakeEvent[]): WakeEvent | undefined {
  if (!candidate.wakeEventId) return undefined;
  return wakeEvents.find((item) => item.id === candidate.wakeEventId);
}

function recentLongDwellDeliveryAt(
  candidate: ProactiveCandidate,
  snapshot: CareDeliverySnapshot,
  asOfMs: number,
): number | null {
  const wakeById = new Map(snapshot.wakeEvents.map((item) => [item.id, item]));
  const times = snapshot.proactiveQueue
    .filter((item) => item.id !== candidate.id && item.status === "delivered" && Boolean(item.deliveredAt))
    .filter((item) => item.wakeEventId && wakeById.get(item.wakeEventId)?.type === "long_dwell")
    .map((item) => Date.parse(item.deliveredAt!))
    .filter((at) => Number.isFinite(at) && at <= asOfMs)
    .sort((left, right) => right - left);
  return times[0] ?? null;
}

function applyQuietHours(
  wake: WakeEvent | undefined,
  observedAt: string,
  quietHoursPolicy: QuietHoursPolicy | undefined,
  allowedReason: "not_long_dwell" | "current_session",
): CareDeliveryDecision {
  if (!quietHoursPolicy) return { deliver: true, reason: allowedReason };
  const quiet = decideQuietHours(quietHoursPolicy, observedAt, wake?.priority ?? "normal");
  if (quiet.defer) {
    return {
      deliver: false,
      reason: "quiet_hours",
      nextAvailableAt: quiet.nextAvailableAt,
    };
  }
  return { deliver: true, reason: allowedReason };
}

/**
 * OH-40/OH-44/OH-47: final deterministic guard before a Care message leaves Runtime.
 * Long-dwell messages are session-bound and rate-limited; visual-result messages are also
 * freshness-bound so a failed notification cannot surface stale "I just saw..." context later.
 * A configured quiet-hours policy is evaluated last, so Brain cannot bypass it.
 */
export function decideCareDelivery(
  candidate: ProactiveCandidate,
  snapshot: CareDeliverySnapshot,
  observedAt: string,
  quietHoursPolicy?: QuietHoursPolicy,
): CareDeliveryDecision {
  const wake = linkedWake(candidate, snapshot.wakeEvents);
  if (wake?.type === "visual_result") {
    const wakeObservedAt = Date.parse(wake.observedAt);
    const asOfMs = Date.parse(observedAt);
    if (
      !Number.isFinite(wakeObservedAt)
      || !Number.isFinite(asOfMs)
      || asOfMs - wakeObservedAt >= VISUAL_RESULT_WAKE_TTL_MS
    ) {
      return { deliver: false, reason: "stale_visual_result" };
    }
    return applyQuietHours(wake, observedAt, quietHoursPolicy, "not_long_dwell");
  }

  if (!wake || wake.type !== "long_dwell") {
    return applyQuietHours(wake, observedAt, quietHoursPolicy, "not_long_dwell");
  }

  const expectedPackage = wake.lifeState.foregroundPackage;
  const expectedSession = wake.lifeState.foregroundSessionStartedAt;
  const current = deriveLifeState(snapshot.observations, observedAt);
  if (
    !expectedPackage
    || !expectedSession
    || current.currentActivity !== "active_on_phone"
    || current.foregroundPackage !== expectedPackage
    || current.foregroundSessionStartedAt !== expectedSession
  ) {
    return { deliver: false, reason: "stale_long_dwell" };
  }

  const asOfMs = Date.parse(observedAt);
  const lastDeliveredAt = recentLongDwellDeliveryAt(candidate, snapshot, asOfMs);
  if (lastDeliveredAt !== null && asOfMs - lastDeliveredAt < CARE_MESSAGE_COOLDOWN_MS) {
    return {
      deliver: false,
      reason: "care_message_cooldown",
      nextAvailableAt: new Date(lastDeliveredAt + CARE_MESSAGE_COOLDOWN_MS).toISOString(),
    };
  }

  return applyQuietHours(wake, observedAt, quietHoursPolicy, "current_session");
}
