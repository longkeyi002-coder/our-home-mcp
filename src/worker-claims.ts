import type { JsonStore } from "./store.js";
import type { ProactiveCandidate, WakeEvent } from "./types.js";

export const WORKER_CLAIM_LEASE_MS = 5 * 60_000;

function activeClaim(processingAt: string | undefined, asOfMs: number): boolean {
  if (!processingAt) return false;
  const claimedAt = Date.parse(processingAt);
  return Number.isFinite(claimedAt) && asOfMs - claimedAt < WORKER_CLAIM_LEASE_MS;
}

/**
 * V0.1 has one Runtime process and one JsonStore instance. Claims are persisted in the
 * same Store so a future accidental concurrent cycle cannot evaluate the same wake event.
 */
export async function claimPendingWakeEvents(
  store: JsonStore,
  asOf = new Date().toISOString(),
  limit = 5,
): Promise<WakeEvent[]> {
  const asOfMs = Date.parse(asOf);
  const claimedIds: string[] = [];
  const data = await store.update((draft) => {
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
      .filter((candidate) => candidate.status === "pending" && !candidate.processingAt && candidate.dueAt <= asOf)
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
    if (candidate) candidate.processingAt = undefined;
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
