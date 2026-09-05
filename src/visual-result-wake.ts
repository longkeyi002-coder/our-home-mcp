import { randomUUID } from "node:crypto";
import { deriveLifeState } from "./life-state.js";
import type { JsonStore } from "./store.js";
import type { LifeObservation, VisualRequestRecord, WakeEvent } from "./types.js";

export const VISUAL_RESULT_WAKE_TTL_MS = 15 * 60_000;

function stringMetadata(item: LifeObservation, key: string): string | null {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function matchingVisualSummary(
  observations: LifeObservation[],
  request: VisualRequestRecord,
): LifeObservation | undefined {
  return observations.find((item) =>
    item.kind === "visual_observation_summary"
    && item.world === "EARTH"
    && item.provenance !== "legacy_unclassified"
    && item.deviceId === request.deviceId
    && stringMetadata(item, "requestId") === request.requestId
    && stringMetadata(item, "packageName") === request.packageName
    && stringMetadata(item, "sessionId") === request.sessionId,
  );
}

export function visualResultWakeExpired(wakeEvent: WakeEvent, asOf: string): boolean {
  if (wakeEvent.type !== "visual_result") return false;
  const observedAtMs = Date.parse(wakeEvent.observedAt);
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(asOfMs)) return true;
  return asOfMs - observedAtMs >= VISUAL_RESULT_WAKE_TTL_MS;
}

/**
 * OH-44/OH-47: completing a requested look does not itself send a message. It creates one
 * bounded follow-up wake so Brain can separately decide whether the structured visual result
 * warrants contacting the user. The raw screenshot is never part of this wake.
 */
export async function enqueueVisualResultWakeEvents(
  store: JsonStore,
  asOf = new Date().toISOString(),
): Promise<WakeEvent[]> {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) return [];

  const created: WakeEvent[] = [];
  await store.update((data) => {
    for (const request of data.visualRequests ?? []) {
      if (request.status !== "observed" || !request.observedAt) continue;
      const observedAtMs = Date.parse(request.observedAt);
      if (
        !Number.isFinite(observedAtMs)
        || observedAtMs > asOfMs
        || asOfMs - observedAtMs >= VISUAL_RESULT_WAKE_TTL_MS
      ) {
        continue;
      }

      const dedupeKey = `visual_result:${request.requestId}`;
      if (data.wakeEvents.some((item) => item.dedupeKey === dedupeKey)) continue;

      const summary = matchingVisualSummary(data.observations, request);
      if (!summary) continue;

      const state = deriveLifeState(data.observations, summary.observedAt);
      const event: WakeEvent = {
        id: randomUUID(),
        type: "visual_result",
        status: "pending",
        priority: "normal",
        createdAt: asOf,
        observedAt: summary.observedAt,
        reason: "A requested visual observation completed. Decide separately whether the structured result warrants contacting the user.",
        dedupeKey,
        lifeState: structuredClone(state),
        previousLifeState: structuredClone(state),
      };
      data.wakeEvents.unshift(event);
      created.push(event);
    }
    data.wakeEvents = data.wakeEvents.slice(0, 200);
  });

  return structuredClone(created);
}
