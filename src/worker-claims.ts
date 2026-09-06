import type { JsonStore } from "./store.js";
import type { ProactiveCandidate, WakeEvent } from "./types.js";

export const WORKER_CLAIM_LEASE_MS = 5 * 60_000;
export const PROACTIVE_RETRY_BASE_MS = 30_000;
export const PROACTIVE_RETRY_MAX_MS = 30 * 60_000;

function activeClaim(processingAt: string | undefined, asOfMs: number): boolean {
  if (!processingAt) return false;
  const claimedAt = Date.parse(processingAt);
  return Number.isFinite(claimedAt) && asOfMs - claimedAt < WORKER_CLAIM_LEASE_MS;
}

export function proactiveRetryDelayMs(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts <= 0) return 0;
  return Math.min(PROACTIVE_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 16), PROACTIVE_RETRY_MAX_MS);
}

function proactiveRetryReady(candidate: ProactiveCandidate, asOfMs: number): boolean {
  if (!candidate.lastAttemptAt || candidate.attempts <= 0) return true;
  const lastAttemptAt = Date.parse(candidate.lastAttemptAt);
  if (!Number.isFinite(lastAttemptAt)) return true;
  return asOfMs - lastAttemptAt >= proactiveRetryDelayMs(candidate.attempts);
}

function supersedeStaleVisualOpportunities(events: WakeEvent[], asOf: string): void {
  const latestByDevice = new Map<string, WakeEvent>();

  for (const event of events) {
    if (event.status !== "pending" || event.type !== "visual_opportunity" || !event.visualContext) continue;
    if (event.visualContext.expiresAt <= asOf) {
      event.status = "dismissed";
      event.processingAt = undefined;
      continue;
    }
    const deviceId = event.visualContext.deviceId;
    const existing = latestByDevice.get(deviceId);
    if (!existing || event.observedAt > existing.observedAt) {
      latestByDevice.set(deviceId, event);
    }
  }

  for (const event of events) {
    if (event.status !== "pending" || event.type !== "visual_opportunity" || !event.visualContext) continue;
    const latest = latestByDevice.get(event.visualContext.deviceId);
    if (latest && latest.id !== event.id) {
      event.status = "dismissed";
      event.processingAt = undefined;
    }
  }
}

/**
 * V0.1 has one Runtime process and one JsonStore instance. Claims are persisted in the
 * same Store so a future accidental concurrent cycle cannot evaluate the same wake event.
 * For visual opportunities, only the newest still-live foreground session per device may
 * reach Brain; an older App transition is stale as soon as a newer session exists.
 */
export async function claimPendingWakeEvents(
  store: JsonStore,
  asOf = new Date().toISOString(),
  limit = 5,
): Promise<WakeEvent[]> {
  const asOfMs = Date.parse(asOf);
  const claimedIds: string[] = [];
  const data = await store.update((draft) => {
    supersedeStaleVisualOpportunities(draft.wakeEvents, asOf);
    for (const event of draft.wakeEvents) {
      if (event.status !== "pending") continue;
      if (activeClaim(event.processingAt, asOfMs)) continue;
      event.processingAt = undefined;
    }
    for (const event of draft.wakeEvents) {
      if (claimedIds.length >= limit) break;
      if (event.status !== "pending" || event.processingAt) continue;
      event.processingAt = asOf;
      claimedIds.push(event.id);
    }
  });
  const ids = new Set(claimedIds);
  return data.wakeEvents.filter((event) => ids.has(event.id));
}

export async function releaseWakeEventClaim(store: JsonStore, id: string): Promise<void> {
  await store.update((data) => {
    const event = data.wakeEvents.find((item) => item.id === id);
    if (event) event.processingAt = undefined;
  });
}

export async function clearWakeEventClaim(store: JsonStore, id: string): Promise<void> {
  await releaseWakeEventClaim(store, id);
}

export async function claimDueProactiveMessages(
  store: JsonStore,
  asOf = new Date().toISOString(),
  limit = 20,
): Promise<ProactiveCandidate[]> {
  const asOfMs = Date.parse(asOf);
  const claimedIds: string[] = [];
  const data = await store.update((draft) => {
    for (const candidate of draft.proactiveQueue) {
      if (candidate.status !== "pending") continue;
      if (activeClaim(candidate.processingAt, asOfMs)) continue;
      candidate.processingAt = undefined;
    }
    const due = draft.proactiveQueue
      .filter((candidate) =>
        candidate.status === "pending"
        && !candidate.processingAt
        && candidate.dueAt <= asOf
        && proactiveRetryReady(candidate, asOfMs),
      )
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    for (const candidate of due.slice(0, limit)) {
      candidate.processingAt = asOf;
      claimedIds.push(candidate.id);
    }
  });
  const ids = new Set(claimedIds);
  return data.proactiveQueue
    .filter((candidate) => ids.has(candidate.id))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
}

export async function releaseProactiveClaim(store: JsonStore, id: string): Promise<void> {
  await store.update((data) => {
    const candidate = data.proactiveQueue.find((item) => item.id === id);
    if (!candidate) return;
    // `processingAt` is stamped from the Runtime cycle's asOf clock. Store.recordProactiveAttempt
    // still uses wall-clock time for backward-compatible direct callers, but Worker retry policy
    // must remain in one clock domain for deterministic replay/catch-up and stable tests.
    if (candidate.processingAt && candidate.attempts > 0) {
      candidate.lastAttemptAt = candidate.processingAt;
    }
    candidate.processingAt = undefined;
  });
}

export async function clearProactiveClaim(store: JsonStore, id: string): Promise<void> {
  await releaseProactiveClaim(store, id);
}

/** A process restart owns the only Store, so claims left by the dead process are orphaned. */
export async function recoverInterruptedWorkerClaims(store: JsonStore): Promise<void> {
  await store.update((data) => {
    for (const event of data.wakeEvents) event.processingAt = undefined;
    for (const candidate of data.proactiveQueue) candidate.processingAt = undefined;
  });
}
