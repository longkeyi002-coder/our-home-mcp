import { deriveLifeStateTransition } from "./life-state.js";
import type { LifeState, WakeEventPriority, WakeEventType } from "./types.js";

export const WAKE_EVENT_MIN_CONFIDENCE = 0.6;
export const WAKE_EVENT_COOLDOWN_MS = 5 * 60 * 1_000;
export const LONG_DWELL_CARE_THRESHOLD_MS = 60 * 60 * 1_000;
export const LONG_DWELL_CARE_COOLDOWN_MS = 60 * 60 * 1_000;

export interface WakeEventDraft {
  type: WakeEventType;
  priority: WakeEventPriority;
  reason: string;
  dedupeKey: string;
}

function cooldownPassed(lastEventAt: string | undefined, observedAt: string, cooldownMs = WAKE_EVENT_COOLDOWN_MS): boolean {
  if (!lastEventAt) return true;
  const previous = Date.parse(lastEventAt);
  const current = Date.parse(observedAt);
  return !Number.isFinite(previous) || !Number.isFinite(current) || current - previous >= cooldownMs;
}

function dedupeKey(type: WakeEventType, previous: LifeState, current: LifeState): string {
  return [type, previous.lastObservedAt ?? "none", current.lastObservedAt ?? "none"].join(":");
}

function longDwellDedupeKey(current: LifeState): string {
  return [
    "long_dwell",
    current.foregroundPackage ?? "unknown",
    current.foregroundSessionStartedAt ?? "unknown-session",
  ].join(":");
}

export function deriveWakeEventDrafts(
  previous: LifeState,
  current: LifeState,
  observedAt: string,
  lastEventAt: Partial<Record<WakeEventType, string>> = {},
): WakeEventDraft[] {
  if (current.confidence < WAKE_EVENT_MIN_CONFIDENCE) return [];

  const transition = deriveLifeStateTransition(previous, current);
  const drafts: WakeEventDraft[] = [];
  const add = (type: WakeEventType, priority: WakeEventPriority, reason: string): void => {
    if (!cooldownPassed(lastEventAt[type], observedAt)) return;
    drafts.push({ type, priority, reason, dedupeKey: dedupeKey(type, previous, current) });
  };

  if (transition) {
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
  }

  const dwellMs = current.foregroundDwellMs;
  if (
    current.currentActivity === "active_on_phone"
    && current.foregroundPackage
    && current.foregroundSessionStartedAt
    && dwellMs !== null
    && dwellMs !== undefined
    && dwellMs >= LONG_DWELL_CARE_THRESHOLD_MS
    && cooldownPassed(lastEventAt.long_dwell, observedAt, LONG_DWELL_CARE_COOLDOWN_MS)
  ) {
    const minutes = Math.floor(dwellMs / 60_000);
    drafts.push({
      type: "long_dwell",
      priority: "normal",
      reason: `foreground app ${current.foregroundPackage} has remained active for about ${minutes} minutes; Care may decide whether this is worth mentioning`,
      // Stable for the whole App session. If the first Care wake is still pending, the
      // store will not stack another pending wake for later dwell milestones.
      dedupeKey: longDwellDedupeKey(current),
    });
  }

  return drafts;
}
