import { deriveLifeState } from "./life-state.js";
import type { LifeObservation, ProactiveCandidate, WakeEvent } from "./types.js";

export const CARE_MESSAGE_COOLDOWN_MS = 60 * 60_000;

export type CareDeliveryReason =
  | "not_long_dwell"
  | "current_session"
  | "stale_long_dwell"
  | "care_message_cooldown";

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

/**
 * OH-40/OH-47: final deterministic guard before a long-dwell Care message leaves the
 * Runtime. A delayed candidate is discarded if the user already left the App/session,
 * and long-dwell Care messages are rate-limited independently from urgent wake types.
 */
export function decideCareDelivery(
  candidate: ProactiveCandidate,
  snapshot: CareDeliverySnapshot,
  observedAt: string,
): CareDeliveryDecision {
  const wake = linkedWake(candidate, snapshot.wakeEvents);
  if (!wake || wake.type !== "long_dwell") {
    return { deliver: true, reason: "not_long_dwell" };
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

  return { deliver: true, reason: "current_session" };
}
