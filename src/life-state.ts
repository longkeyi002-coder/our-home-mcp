import type {
  ConnectivityState,
  DevicePresence,
  LifeActivity,
  LifeObservation,
  LifeState,
} from "./types.js";

export const LIFE_STATE_ACTIVITY_WINDOW_MS = 5 * 60 * 1_000;
export const LIFE_STATE_OBSERVATION_WINDOW_MS = 15 * 60 * 1_000;

type TransitionField = Exclude<keyof LifeState, "confidence" | "reasons">;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function newest(observations: LifeObservation[], predicate: (item: LifeObservation) => boolean): LifeObservation | undefined {
  return observations
    .filter(predicate)
    .sort((left, right) => timestamp(right.observedAt) - timestamp(left.observedAt))[0];
}

function isUsableObservation(item: LifeObservation, asOfMs: number): boolean {
  if (item.source === "mock" || item.confidence === "inferred") return false;
  const observedMs = timestamp(item.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > asOfMs) return false;
  if (item.expiresAt && timestamp(item.expiresAt) < asOfMs) return false;
  return asOfMs - observedMs <= LIFE_STATE_OBSERVATION_WINDOW_MS;
}

function metadataBoolean(item: LifeObservation | undefined, key: string): boolean | null {
  const value = item?.metadata?.[key];
  return typeof value === "boolean" ? value : null;
}

function metadataString(item: LifeObservation | undefined, key: string): string | null {
  const value = item?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(item: LifeObservation | undefined, key: string): number | null {
  const value = item?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asDevicePresence(value: string | undefined): DevicePresence {
  return value === "online" || value === "screen_on" || value === "screen_off" || value === "idle"
    ? value
    : "unknown";
}

function asConnectivity(value: unknown): ConnectivityState {
  return value === "online" || value === "offline" || value === "unknown" ? value : "unknown";
}

function isPhoneActivity(item: LifeObservation): boolean {
  return item.kind === "screen_app" && Boolean(item.value?.trim())
    || item.kind === "usage_summary" && Boolean(metadataString(item, "currentPackage") || item.value?.trim())
    || item.kind === "device_presence" && (item.value === "screen_on");
}

function foregroundPackage(item: LifeObservation | undefined): string | null {
  if (!item) return null;
  if (item.kind === "usage_summary") return metadataString(item, "currentPackage") ?? item.value?.trim() ?? null;
  return item.value?.trim() || null;
}

function stateValue(state: LifeState, field: TransitionField): string {
  const value = state[field];
  return value === null ? "null" : String(value);
}

export function deriveLifeState(observations: LifeObservation[], observedAt: string): LifeState {
  const asOfMs = timestamp(observedAt);
  const usable = observations.filter((item) => isUsableObservation(item, asOfMs));
  const historical = observations.filter(
    (item) => item.source !== "mock" && item.confidence !== "inferred" && timestamp(item.observedAt) <= asOfMs,
  );
  const latestAny = newest(historical, () => true);
  const latestDevice = newest(usable, (item) => item.kind === "device_presence");
  const latestForeground = newest(
    usable,
    (item) => (item.kind === "screen_app" && Boolean(item.value?.trim()))
      || (item.kind === "usage_summary" && Boolean(foregroundPackage(item))),
  );
  const latestConnectivity = newest(usable, (item) => item.metadata?.connectivityState !== undefined);
  const latestActivity = newest(historical, isPhoneActivity);

  const lastObservedAt = latestAny?.observedAt ?? null;
  const lastPhoneActivityAt = latestActivity?.observedAt ?? null;
  const devicePresence = asDevicePresence(latestDevice?.value);
  const rawForegroundPackage = foregroundPackage(latestForeground);
  const foregroundAgeMs = latestForeground ? asOfMs - timestamp(latestForeground.observedAt) : Number.POSITIVE_INFINITY;
  const hasRecentForeground = Boolean(rawForegroundPackage) && foregroundAgeMs <= LIFE_STATE_ACTIVITY_WINDOW_MS;
  const currentForegroundPackage = hasRecentForeground ? rawForegroundPackage : null;
  const batteryPercent = metadataNumber(latestDevice, "batteryPercent");
  const charging = metadataBoolean(latestDevice, "charging");
  const connectivityState = asConnectivity(latestConnectivity?.metadata?.connectivityState);
  const activityAgeMs = lastPhoneActivityAt ? asOfMs - timestamp(lastPhoneActivityAt) : Number.POSITIVE_INFINITY;
  const hasRecentActivity = hasRecentForeground;
  const hasRecentDevice = Boolean(latestDevice);
  const reasons: string[] = [];
  let currentActivity: LifeActivity = "unknown";
  let confidence = 0;

  if (connectivityState === "offline" && !hasRecentActivity) {
    currentActivity = "offline";
    confidence = 0.9;
    reasons.push("latest phone observation reports offline connectivity");
  } else if (hasRecentActivity && connectivityState !== "offline") {
    currentActivity = "active_on_phone";
    confidence = latestForeground?.confidence === "observed" ? 0.9 : 0.75;
    reasons.push("foreground app observed recently");
  } else if (charging === true && hasRecentDevice) {
    currentActivity = "charging";
    confidence = 0.8;
    reasons.push("phone reports charging=true");
    if (activityAgeMs <= LIFE_STATE_OBSERVATION_WINDOW_MS) {
      reasons.push("charging does not establish what the user is doing");
    }
  } else if (hasRecentDevice && (devicePresence === "idle" || devicePresence === "screen_off" || activityAgeMs > LIFE_STATE_ACTIVITY_WINDOW_MS)) {
    currentActivity = "probably_idle";
    confidence = 0.65;
    reasons.push("no recent foreground app activity was observed");
  } else if (connectivityState === "unknown" && !hasRecentDevice) {
    reasons.push("no current phone observation is available");
  }

  if (connectivityState === "offline" && hasRecentActivity) {
    currentActivity = "unknown";
    confidence = 0.35;
    reasons.push("offline connectivity conflicts with a recent foreground app observation");
  }
  if (currentActivity === "unknown" && reasons.length === 0) {
    reasons.push("available observations are insufficient or stale");
  }

  return {
    lastObservedAt,
    lastPhoneActivityAt,
    devicePresence,
    foregroundPackage: currentForegroundPackage,
    batteryPercent,
    charging,
    connectivityState,
    currentActivity,
    confidence,
    reasons,
  };
}

export interface LifeStateTransition {
  previous: LifeState;
  current: LifeState;
  changedFields: TransitionField[];
}

export function deriveLifeStateTransition(previous: LifeState, current: LifeState): LifeStateTransition | null {
  const transitionFields: TransitionField[] = [
    "lastObservedAt",
    "lastPhoneActivityAt",
    "devicePresence",
    "foregroundPackage",
    "batteryPercent",
    "charging",
    "connectivityState",
    "currentActivity",
  ];
  const fields = transitionFields.filter((field) => stateValue(previous, field) !== stateValue(current, field));
  return fields.length > 0 ? { previous, current, changedFields: fields } : null;
}
