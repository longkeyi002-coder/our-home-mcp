import { deriveLifeStateTransition } from "./life-state.js";
import type { LifeState, WakeEventPriority, WakeEventType } from "./types.js";

export const WAKE_EVENT_MIN_CONFIDENCE = 0.6;
export const WAKE_EVENT_COOLDOWN_MS = 5 * 60 * 1_000;

export interface WakeEventDraft {
  type: WakeEventType;
  priority: WakeEventPriority;
  reason: string;
  dedupeKey: string;
}

function cooldownPassed(lastEventAt: string | undefined, observedAt: string): boolean {
  if (!lastEventAt) return true;
  const previous = Date.parse(lastEventAt);
  const current = Date.parse(observedAt);
  return !Number.isFinite(previous) || !Number.isFinite(current) || current - previous >= WAKE_EVENT_COOLDOWN_MS;
}

function dedupeKey(type: WakeEventType, current: LifeState): string {
  return [type, current.currentActivity, current.connectivityState, current.charging ?? "unknown"].join(":");
}

export function deriveWakeEventDrafts(
  previous: LifeState,
  current: LifeState,
  observedAt: string,
  lastEventAt: Partial<Record<WakeEventType, string>> = {},
): WakeEventDraft[] {
  const transition = deriveLifeStateTransition(previous, current);
  if (!transition || current.confidence < WAKE_EVENT_MIN_CONFIDENCE) return [];

  const drafts: WakeEventDraft[] = [];
  const add = (type: WakeEventType, priority: WakeEventPriority, reason: string): void => {
    if (!cooldownPassed(lastEventAt[type], observedAt)) return;
    drafts.push({ type, priority, reason, dedupeKey: dedupeKey(type, current) });
  };

  if (previous.currentActivity !== "active_on_phone" && current.currentActivity === "active_on_phone") {
    add("became_active", "normal", "foreground app activity was observed after a non-active state");
  }
  if (previous.currentActivity === "active_on_phone" && current.currentActivity === "probably_idle") {
    add("became_idle", "normal", "recent foreground app activity is no longer present");
  }
  if (previous.connectivityState !== "offline" && current.connectivityState === "offline") {
    add("device_offline", "high", "phone connectivity changed to offline");
  }
  if (previous.charging !== true && current.charging === true) {
    add("charging_started", "low", "phone charging changed to true");
  }
  if (
    previous.batteryPercent !== null &&
    previous.batteryPercent > 20 &&
    current.batteryPercent !== null &&
    current.batteryPercent <= 20 &&
    current.charging !== true
  ) {
    add("battery_low", "high", "battery crossed the 20% threshold while not charging");
  }

  return drafts;
}
