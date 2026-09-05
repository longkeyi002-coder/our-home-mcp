import type { JsonStore } from "./store.js";

/**
 * Records one notifier attempt using the Runtime cycle clock rather than wall-clock time.
 *
 * Worker retry eligibility is evaluated against the cycle's `asOf` timestamp. Persisting
 * `lastAttemptAt` from a different clock makes deterministic replay/tests race the real clock
 * and can also make catch-up simulations behave inconsistently. Keep the operational timestamp
 * on the same clock domain as claim/retry evaluation.
 */
export async function recordProactiveAttemptAt(
  store: JsonStore,
  id: string,
  attemptedAt: string,
  error?: string,
): Promise<void> {
  if (!Number.isFinite(Date.parse(attemptedAt))) {
    throw new Error(`Invalid proactive attempt timestamp: ${attemptedAt}`);
  }

  await store.update((data) => {
    const candidate = data.proactiveQueue.find((item) => item.id === id);
    if (!candidate) throw new Error(`Proactive candidate not found: ${id}`);
    candidate.attempts += 1;
    candidate.lastAttemptAt = attemptedAt;
    candidate.lastError = error;
  });
}
