import { isEarthEvidence } from "./world-boundary.js";
import type { LifeObservation, OurHomeData } from "./types.js";

export interface PhoneTelemetryStatus {
  deviceId: string;
  registeredAt: string | null;
  appVersion: string | null;
  hasPushAddress: boolean;
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
  lastObservationAt: string | null;
}

function latestObservedAt(items: LifeObservation[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (latest === null || item.observedAt > latest) latest = item.observedAt;
  }
  return latest;
}

/**
 * OH-31/OH-66: phone liveness is derived from persisted observations instead of
 * maintaining a second mutable source of truth. Credentials are never returned.
 */
export function derivePhoneTelemetryStatus(data: OurHomeData): PhoneTelemetryStatus[] {
  const evidence = data.observations.filter(isEarthEvidence);
  const deviceIds = new Set<string>();
  for (const registration of data.phoneDeviceRegistrations) deviceIds.add(registration.deviceId);
  for (const observation of evidence) {
    if (observation.deviceId) deviceIds.add(observation.deviceId);
  }

  return [...deviceIds]
    .map((deviceId) => {
      const registration = data.phoneDeviceRegistrations.find((item) => item.deviceId === deviceId);
      const observations = evidence.filter((item) => item.deviceId === deviceId && item.source === "phone");
      const heartbeatObservations = observations.filter((item) => item.kind === "device_presence");

      return {
        deviceId,
        registeredAt: registration?.updatedAt ?? null,
        appVersion: registration?.appVersion ?? null,
        hasPushAddress: Boolean(registration?.pushToken),
        lastSeenAt: latestObservedAt(observations),
        lastHeartbeatAt: latestObservedAt(heartbeatObservations),
        lastObservationAt: latestObservedAt(observations),
      };
    })
    .sort((left, right) => (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "") || left.deviceId.localeCompare(right.deviceId));
}

