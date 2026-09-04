import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { BrainAdapter } from "./brain.js";
import type { JsonStore } from "./store.js";
import type { LifeContext, ProactiveCandidate, WakeDecision, WakeEvent } from "./types.js";
import { HermesDecisionEngine } from "./hermes-decision.js";
import { FcmHttpV1Sender, FcmNotifier } from "./fcm.js";
import {
  claimDueProactiveMessages,
  claimPendingWakeEvents,
  clearProactiveClaim,
  clearWakeEventClaim,
  recoverInterruptedWorkerClaims,
  releaseProactiveClaim,
} from "./worker-claims.js";

export type { BrainAdapter } from "./brain.js";
/** Backward-compatible alias for older callers/tests. */
export type LifeDecisionEngine = BrainAdapter;

export interface ProactiveNotifier {
  deliver(candidate: ProactiveCandidate): Promise<void>;
}

const decisionResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore") }),
  z.object({ action: z.literal("proactive_message"), candidate: z.object({
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5_000),
    reason: z.string().trim().min(1).max(1_000),
    dueAt: z.string().datetime({ offset: true }).optional(),
    dedupeKey: z.string().trim().max(500).optional(),
  }) }),
]);

/** Generic HTTP brain adapter. Any provider/self-hosted agent can implement this contract. */
export class WebhookDecisionEngine implements BrainAdapter {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async evaluate(input: { wakeEvent: WakeEvent; context: LifeContext }) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Decision engine returned HTTP ${response.status}`);
    const parsed = decisionResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Decision engine returned an invalid candidate payload");
    return parsed.data;
  }
}

export class NoopNotifier implements ProactiveNotifier {
  async deliver(candidate: ProactiveCandidate): Promise<void> {
    throw new Error(`No notifier configured for proactive candidate ${candidate.id}`);
  }
}

export class WebhookNotifier implements ProactiveNotifier {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async deliver(candidate: ProactiveCandidate): Promise<void> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "our_home.proactive_message",
        id: candidate.id,
        title: candidate.title,
        message: candidate.message,
        reason: candidate.reason,
        createdAt: candidate.createdAt,
        dueAt: candidate.dueAt,
        source: candidate.source,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Notifier returned HTTP ${response.status}`);
  }
}

export async function runProactiveCycle(
  store: JsonStore,
  notifier: ProactiveNotifier,
  asOf = new Date(),
  decisionEngine?: BrainAdapter,
): Promise<{ heartbeatId: string; wakeEventCount: number; dueCount: number; deliveredCount: number; failedCount: number }> {
  const observedAt = asOf.toISOString();
  const heartbeat = await store.recordHeartbeat("独立 Life Loop 心跳：检查主动消息队列。");
  const wakeEvents = await store.evaluateWakeEvents(observedAt);

  if (decisionEngine) {
    const claimedWakeEvents = await claimPendingWakeEvents(store, observedAt, 5);
    for (const wakeEvent of claimedWakeEvents) {
      try {
        const decision = decisionResponseSchema.parse(await decisionEngine.evaluate({
          wakeEvent,
          context: store.getLifeContext(observedAt),
        }));
        await store.applyWakeDecision(wakeEvent.id, decision, observedAt);
        await clearWakeEventClaim(store, wakeEvent.id);
      } catch (error) {
        // Do not release the claim immediately. The persisted five-minute lease acts as
        // the V0.1 Brain retry cooldown, so a failing Hermes/provider cannot be called
        // again every worker cycle. The claim becomes eligible automatically after the
        // lease expires; a clean Runtime restart also recovers orphaned claims.
        const message = error instanceof Error ? error.message : "Unknown decision engine error";
        process.stderr.write(`[our-home] wake decision failed: ${wakeEvent.id}: ${message}\n`);
      }
    }
  }

  const due = await claimDueProactiveMessages(store, observedAt, 20);
  let deliveredCount = 0;
  let failedCount = 0;

  for (const candidate of due) {
    try {
      await notifier.deliver(candidate);
      await store.recordProactiveAttempt(candidate.id);
      await store.resolveProactiveMessage(candidate.id, "delivered");
      await clearProactiveClaim(store, candidate.id);
      deliveredCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown notifier error";
      await store.recordProactiveAttempt(candidate.id, message);
      await releaseProactiveClaim(store, candidate.id);
      process.stderr.write(`[our-home] proactive delivery failed: ${candidate.id}: ${message}\n`);
    }
  }

  return { heartbeatId: heartbeat.id, wakeEventCount: wakeEvents.length, dueCount: due.length, deliveredCount, failedCount };
}

const intervalMs = Number(process.env.OUR_HOME_WORKER_INTERVAL_MS ?? "60000");
const externalTimeoutMs = Number(process.env.OUR_HOME_EXTERNAL_TIMEOUT_MS ?? "20000");
const webhookUrl = process.env.OUR_HOME_NOTIFY_WEBHOOK_URL;
const webhookToken = process.env.OUR_HOME_NOTIFY_WEBHOOK_TOKEN;
const decisionUrl = process.env.OUR_HOME_DECISION_WEBHOOK_URL;
const decisionToken = process.env.OUR_HOME_DECISION_WEBHOOK_TOKEN;
const hermesApiUrl = process.env.OUR_HOME_HERMES_API_URL;
const hermesApiKey = process.env.OUR_HOME_HERMES_API_KEY;
const hermesConversation = process.env.OUR_HOME_HERMES_CONVERSATION;
const hermesModel = process.env.OUR_HOME_HERMES_MODEL;
const firebaseProjectId = process.env.OUR_HOME_FIREBASE_PROJECT_ID;
const googleCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

export function selectNotifier(
  store: JsonStore,
  config: {
    firebaseProjectId?: string;
    googleCredentials?: string;
    webhookUrl?: string;
    webhookToken?: string;
    timeoutMs?: number;
  },
): ProactiveNotifier {
  const timeoutMs = config.timeoutMs ?? externalTimeoutMs;
  if (config.firebaseProjectId && config.googleCredentials) {
    return new FcmNotifier(store, new FcmHttpV1Sender(config.firebaseProjectId, config.googleCredentials, fetch, timeoutMs));
  }
  return config.webhookUrl
    ? new WebhookNotifier(config.webhookUrl, config.webhookToken, timeoutMs)
    : new NoopNotifier();
}

export interface RuntimeWorkerHandle {
  stop(): void;
  done: Promise<void>;
}

/**
 * Starts the only Life Loop allowed to mutate the Runtime Store in V0.1.
 * Each cycle is fully awaited before the delay and next cycle, so cycles cannot overlap.
 */
export function startRuntimeWorker(store: JsonStore): RuntimeWorkerHandle {
  if (!Number.isInteger(intervalMs) || intervalMs < 5_000) {
    throw new Error("OUR_HOME_WORKER_INTERVAL_MS must be an integer of at least 5000ms");
  }
  if (!Number.isInteger(externalTimeoutMs) || externalTimeoutMs < 1_000 || externalTimeoutMs > 120_000) {
    throw new Error("OUR_HOME_EXTERNAL_TIMEOUT_MS must be an integer between 1000 and 120000ms");
  }

  const notifier = selectNotifier(store, {
    firebaseProjectId,
    googleCredentials,
    webhookUrl,
    webhookToken,
    timeoutMs: externalTimeoutMs,
  });
  const decisionEngine: BrainAdapter | undefined = hermesApiUrl && hermesApiKey
    ? new HermesDecisionEngine({
      apiUrl: hermesApiUrl,
      apiKey: hermesApiKey,
      conversation: hermesConversation,
      model: hermesModel,
      timeoutMs: externalTimeoutMs,
    })
    : decisionUrl
      ? new WebhookDecisionEngine(decisionUrl, decisionToken, externalTimeoutMs)
      : undefined;

  const controller = new AbortController();
  const done = (async () => {
    await recoverInterruptedWorkerClaims(store);
    while (!controller.signal.aborted) {
      try {
        const result = await runProactiveCycle(store, notifier, new Date(), decisionEngine);
        process.stderr.write(
          `[our-home] heartbeat=${result.heartbeatId} due=${result.dueCount} delivered=${result.deliveredCount} failed=${result.failedCount}\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown worker error";
        process.stderr.write(`[our-home] worker cycle failed: ${message}\n`);
      }
      if (controller.signal.aborted) break;
      try {
        await delay(intervalMs, undefined, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) break;
        throw error;
      }
    }
  })();

  return {
    stop: () => controller.abort(),
    done,
  };
}
