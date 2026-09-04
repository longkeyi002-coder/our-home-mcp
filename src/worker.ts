import type { JsonStore } from "./store.js";
import { z } from "zod";
import type { LifeContext, ProactiveCandidate, WakeDecision, WakeEvent } from "./types.js";
import { HermesDecisionEngine } from "./hermes-decision.js";
import { FcmHttpV1Sender, FcmNotifier } from "./fcm.js";

export interface ProactiveNotifier {
  deliver(candidate: ProactiveCandidate): Promise<void>;
}

export interface LifeDecisionEngine {
  evaluate(input: { wakeEvent: WakeEvent; context: LifeContext }): Promise<WakeDecision>;
}

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 30_000;

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

export class WebhookDecisionEngine implements LifeDecisionEngine {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = DEFAULT_OUTBOUND_TIMEOUT_MS,
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
    private readonly timeoutMs = DEFAULT_OUTBOUND_TIMEOUT_MS,
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
  decisionEngine?: LifeDecisionEngine,
): Promise<{ heartbeatId: string; wakeEventCount: number; dueCount: number; deliveredCount: number; failedCount: number }> {
  const heartbeat = await store.recordHeartbeat("独立 Life Loop 心跳：检查主动消息队列。");
  const wakeEvents = await store.evaluateWakeEvents(asOf.toISOString());
  if (decisionEngine) {
    for (const wakeEvent of store.listWakeEvents("pending", 5)) {
      const isHermesActivation = decisionEngine instanceof HermesDecisionEngine;
      if (isHermesActivation) {
        await store.recordRuntimeDiagnostic("lastHermesActivation", {
          occurredAt: asOf.toISOString(),
          status: "started",
          wakeEventId: wakeEvent.id,
        });
      }
      try {
        const decision = decisionResponseSchema.parse(await decisionEngine.evaluate({
          wakeEvent,
          context: store.getLifeContext(asOf.toISOString()),
        }));
        await store.applyWakeDecision(wakeEvent.id, decision, asOf.toISOString());
        await store.recordRuntimeDiagnostic("lastWakeDecision", {
          occurredAt: asOf.toISOString(),
          status: "succeeded",
          wakeEventId: wakeEvent.id,
          action: decision.action,
        });
        if (isHermesActivation) {
          await store.recordRuntimeDiagnostic("lastHermesActivation", {
            occurredAt: asOf.toISOString(),
            status: "succeeded",
            wakeEventId: wakeEvent.id,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown decision engine error";
        await store.recordRuntimeDiagnostic("lastWakeDecision", {
          occurredAt: asOf.toISOString(),
          status: "failed",
          wakeEventId: wakeEvent.id,
          detail: message,
        });
        if (isHermesActivation) {
          await store.recordRuntimeDiagnostic("lastHermesActivation", {
            occurredAt: asOf.toISOString(),
            status: "failed",
            wakeEventId: wakeEvent.id,
            detail: message,
          });
        }
        process.stderr.write(`[our-home] wake decision failed: ${wakeEvent.id}: ${message}\n`);
      }
    }
  }
  const due = store.listDueProactiveMessages(asOf.toISOString());
  let deliveredCount = 0;
  let failedCount = 0;

  for (const candidate of due) {
    try {
      await notifier.deliver(candidate);
      await store.recordProactiveAttempt(candidate.id);
      await store.resolveProactiveMessage(candidate.id, "delivered");
      await store.recordRuntimeDiagnostic("lastProactiveDelivery", {
        occurredAt: asOf.toISOString(),
        status: "succeeded",
        candidateId: candidate.id,
      });
      deliveredCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown notifier error";
      await store.recordProactiveAttempt(candidate.id, message);
      await store.recordRuntimeDiagnostic("lastProactiveDelivery", {
        occurredAt: asOf.toISOString(),
        status: "failed",
        candidateId: candidate.id,
        detail: message,
      });
      process.stderr.write(`[our-home] proactive delivery failed: ${candidate.id}: ${message}\n`);
    }
  }

  return { heartbeatId: heartbeat.id, wakeEventCount: wakeEvents.length, dueCount: due.length, deliveredCount, failedCount };
}

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
  const timeoutMs = config.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  if (config.firebaseProjectId && config.googleCredentials) {
    return new FcmNotifier(store, new FcmHttpV1Sender(config.firebaseProjectId, config.googleCredentials, fetch, timeoutMs));
  }
  return config.webhookUrl
    ? new WebhookNotifier(config.webhookUrl, config.webhookToken, timeoutMs)
    : new NoopNotifier();
}

export interface ProactiveLoopHandle {
  stop(): void;
}

export interface ProactiveLoopOptions {
  intervalMs: number;
  notifier: ProactiveNotifier;
  decisionEngine?: LifeDecisionEngine;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Runs exactly one cycle at a time. The next timer is scheduled only after the
 * current cycle has settled, so a slow Hermes/webhook call cannot overlap the next cycle.
 */
export function startProactiveLoop(store: JsonStore, options: ProactiveLoopOptions): ProactiveLoopHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));

  const run = async () => {
    try {
      const result = await runProactiveCycle(store, options.notifier, now(), options.decisionEngine);
      log(`[our-home] heartbeat=${result.heartbeatId} due=${result.dueCount} delivered=${result.deliveredCount} failed=${result.failedCount}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      log(`[our-home] worker cycle failed: ${message}`);
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), options.intervalMs);
    }
  };

  void run();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function startProactiveLoopFromEnv(store: JsonStore): ProactiveLoopHandle {
  const intervalMs = Number(process.env.OUR_HOME_WORKER_INTERVAL_MS ?? "60000");
  const timeoutMs = Number(process.env.OUR_HOME_OUTBOUND_TIMEOUT_MS ?? String(DEFAULT_OUTBOUND_TIMEOUT_MS));
  if (!Number.isInteger(intervalMs) || intervalMs < 5_000) {
    throw new Error("OUR_HOME_WORKER_INTERVAL_MS must be an integer of at least 5000ms");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("OUR_HOME_OUTBOUND_TIMEOUT_MS must be an integer of at least 1000ms");
  }

  const notifier = selectNotifier(store, {
    firebaseProjectId: process.env.OUR_HOME_FIREBASE_PROJECT_ID,
    googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    webhookUrl: process.env.OUR_HOME_NOTIFY_WEBHOOK_URL,
    webhookToken: process.env.OUR_HOME_NOTIFY_WEBHOOK_TOKEN,
    timeoutMs,
  });
  const hermesApiUrl = process.env.OUR_HOME_HERMES_API_URL;
  const hermesApiKey = process.env.OUR_HOME_HERMES_API_KEY;
  const decisionUrl = process.env.OUR_HOME_DECISION_WEBHOOK_URL;
  const decisionEngine = hermesApiUrl && hermesApiKey
    ? new HermesDecisionEngine({
      apiUrl: hermesApiUrl,
      apiKey: hermesApiKey,
      conversation: process.env.OUR_HOME_HERMES_CONVERSATION,
      model: process.env.OUR_HOME_HERMES_MODEL,
      timeoutMs,
    })
    : decisionUrl
      ? new WebhookDecisionEngine(decisionUrl, process.env.OUR_HOME_DECISION_WEBHOOK_TOKEN, timeoutMs)
      : undefined;

  return startProactiveLoop(store, { intervalMs, notifier, decisionEngine });
}
