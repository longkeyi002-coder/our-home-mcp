import { JsonStore, parseBoolean } from "./store.js";
import { z } from "zod";
import type { LifeContext, ProactiveCandidate } from "./types.js";

export interface ProactiveNotifier {
  deliver(candidate: ProactiveCandidate, idempotencyKey: string): Promise<void>;
}

export interface LifeDecisionEngine {
  evaluate(context: LifeContext): Promise<Array<{
    title: string;
    message: string;
    reason: string;
    dueAt?: string;
    dedupeKey?: string;
  }>>;
}

const decisionResponseSchema = z.object({
  candidates: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5_000),
    reason: z.string().trim().min(1).max(1_000),
    dueAt: z.string().datetime({ offset: true }).optional(),
    dedupeKey: z.string().trim().max(500).optional(),
  })).max(20),
});

export class WebhookDecisionEngine implements LifeDecisionEngine {
  constructor(
    private readonly url: string,
    private readonly token?: string,
  ) {}

  async evaluate(context: LifeContext) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "our_home.life_context", context }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Decision engine returned HTTP ${response.status}`);
    const parsed = decisionResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Decision engine returned an invalid candidate payload");
    return parsed.data.candidates;
  }
}

export class NoopNotifier implements ProactiveNotifier {
  async deliver(candidate: ProactiveCandidate, _idempotencyKey: string): Promise<void> {
    throw new Error(`No notifier configured for proactive candidate ${candidate.id}`);
  }
}

export class WebhookNotifier implements ProactiveNotifier {
  constructor(
    private readonly url: string,
    private readonly token?: string,
  ) {}

  async deliver(candidate: ProactiveCandidate, idempotencyKey: string): Promise<void> {
    const headers: Record<string, string> = { "content-type": "application/json", "idempotency-key": idempotencyKey };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "our_home.proactive_message",
        idempotencyKey,
        id: candidate.id,
        title: candidate.title,
        message: candidate.message,
        reason: candidate.reason,
        createdAt: candidate.createdAt,
        dueAt: candidate.dueAt,
        source: candidate.source,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Notifier returned HTTP ${response.status}`);
  }
}

let activeCycle: Promise<{ heartbeatId: string; dueCount: number; deliveredCount: number; failedCount: number }> | undefined;

export function runProactiveCycle(
  store: JsonStore,
  notifier: ProactiveNotifier,
  asOf = new Date(),
  decisionEngine?: LifeDecisionEngine,
): Promise<{ heartbeatId: string; dueCount: number; deliveredCount: number; failedCount: number }> {
  if (activeCycle) return activeCycle;
  activeCycle = runProactiveCycleInternal(store, notifier, asOf, decisionEngine).finally(() => {
    activeCycle = undefined;
  });
  return activeCycle;
}

async function runProactiveCycleInternal(
  store: JsonStore,
  notifier: ProactiveNotifier,
  asOf = new Date(),
  decisionEngine?: LifeDecisionEngine,
): Promise<{ heartbeatId: string; dueCount: number; deliveredCount: number; failedCount: number }> {
  const heartbeat = await store.recordHeartbeat("独立 Life Loop 心跳：检查主动消息队列。");
  if (decisionEngine) {
    try {
      const candidates = await decisionEngine.evaluate(store.getLifeContext(asOf.toISOString()));
      for (const candidate of candidates) {
        await store.scheduleProactiveMessage({
          ...candidate,
          dueAt: candidate.dueAt ?? asOf.toISOString(),
          dedupeKey: candidate.dedupeKey ?? `${candidate.title}\u0000${candidate.message}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown decision engine error";
      process.stderr.write(`[our-home] decision engine failed: ${message}\n`);
    }
  }
  const due = await store.claimDueProactiveMessages(asOf);
  let deliveredCount = 0;
  let failedCount = 0;

  for (const candidate of due) {
    try {
      const idempotencyKey = `our-home:${candidate.id}`;
      await notifier.deliver(candidate, idempotencyKey);
      await store.recordProactiveAttempt(candidate.id, undefined, candidate.claimId);
      await store.resolveProactiveMessage(candidate.id, "delivered", candidate.claimId);
      deliveredCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown notifier error";
      await store.recordProactiveAttempt(candidate.id, message, candidate.claimId, true);
      process.stderr.write(`[our-home] proactive delivery failed: ${candidate.id}: ${message}\n`);
    }
  }

  return { heartbeatId: heartbeat.id, dueCount: due.length, deliveredCount, failedCount };
}

const dataFile = process.env.OUR_HOME_DATA_FILE ?? "./data/our-home.sqlite";
const seed = parseBoolean(process.env.OUR_HOME_SEED, true);
const intervalMs = Number(process.env.OUR_HOME_WORKER_INTERVAL_MS ?? "60000");
const webhookUrl = process.env.OUR_HOME_NOTIFY_WEBHOOK_URL;
const webhookToken = process.env.OUR_HOME_NOTIFY_WEBHOOK_TOKEN;
const decisionUrl = process.env.OUR_HOME_DECISION_WEBHOOK_URL;
const decisionToken = process.env.OUR_HOME_DECISION_WEBHOOK_TOKEN;

if (process.env.OUR_HOME_RUN_WORKER === "true") {
  if (!Number.isInteger(intervalMs) || intervalMs < 5_000) {
    throw new Error("OUR_HOME_WORKER_INTERVAL_MS must be an integer of at least 5000ms");
  }

  const store = await JsonStore.open(dataFile, seed);
  const notifier: ProactiveNotifier = webhookUrl
    ? new WebhookNotifier(webhookUrl, webhookToken)
    : new NoopNotifier();
  const decisionEngine = decisionUrl
    ? new WebhookDecisionEngine(decisionUrl, decisionToken)
    : undefined;

  const cycle = async () => {
    const result = await runProactiveCycle(store, notifier, new Date(), decisionEngine);
    process.stderr.write(
      `[our-home] heartbeat=${result.heartbeatId} due=${result.dueCount} delivered=${result.deliveredCount} failed=${result.failedCount}\n`,
    );
  };

  await cycle();
  setInterval(() => void cycle().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    process.stderr.write(`[our-home] worker cycle failed: ${message}\n`);
  }), intervalMs);
}
