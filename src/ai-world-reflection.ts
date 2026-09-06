import { z } from "zod";
import {
  addAiWorldThoughtThread,
  listDueAiWorldReviews,
  readAiWorldContinuity,
  reviewAiWorldExperience,
  updateAiWorldNote,
  updateAiWorldThoughtThread,
  type AiWorldDueReview,
} from "./ai-world-continuity.js";
import { listAiWorldSoulTendencies } from "./ai-world-soul.js";
import type { JsonStore } from "./store.js";
import type { AiWorldItemProvenance, OurHomeData } from "./types.js";

export const REFLECTION_SUCCESS_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
export const REFLECTION_FAILURE_BACKOFF_MS = 60 * 60 * 1_000;
export const REFLECTION_DAILY_ATTEMPT_LIMIT = 3;
export const REFLECTION_PROCESSING_LEASE_MS = 20 * 60 * 1_000;
export const REFLECTION_RECORD_RESCHEDULE_MS = 14 * 24 * 60 * 60 * 1_000;
export const REFLECTION_IGNORE_RESCHEDULE_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_REFLECTION_SOUL_CONTEXT = 10;

const reflectionDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore") }).strict(),
  z.object({
    action: z.literal("record_reflection"),
    reflection: z.object({
      title: z.string().trim().min(1).max(300),
      summary: z.string().trim().min(1).max(5_000),
      conclusion: z.string().trim().min(1).max(5_000).optional(),
      openQuestion: z.string().trim().min(1).max(2_000).optional(),
    }).strict(),
  }).strict(),
]);

export type AiWorldReflectionDecision = z.infer<typeof reflectionDecisionSchema>;

export interface AiWorldReflectionSource {
  recordType: AiWorldDueReview["recordType"];
  recordId: string;
  dueAt: string;
  provenance: AiWorldItemProvenance;
  title?: string;
  summary: string;
  conclusion?: string;
  openQuestion?: string;
  evidenceRefs?: string[];
}

export interface AiWorldReflectionSoulContext {
  interestKey: string;
  score: number;
  updatedAt: string;
}

export interface AiWorldReflectionInput {
  asOf: string;
  source: AiWorldReflectionSource;
  aiWorldState: {
    location: string;
    room: string;
    weather: string;
    workState: string;
    currentActivity: string;
    phaseKey: string;
    updatedAt: string;
  };
  /** Read-only Soul context. The reflection contract has no Soul mutation action. */
  soul: AiWorldReflectionSoulContext[];
}

export interface AiWorldReflectionAdapter {
  evaluate(input: AiWorldReflectionInput): Promise<unknown>;
}

export interface AiWorldReflectionRuntimeState {
  utcDay: string;
  attemptsToday: number;
  lastCompletedAt?: string;
  retryAfter?: string;
  processing?: {
    sourceKey: string;
    startedAt: string;
    leaseUntil: string;
  };
}

type ReflectionStoreData = OurHomeData & {
  /** Runtime control-plane state; this is not canonical AI World memory. */
  aiWorldReflectionRuntime?: AiWorldReflectionRuntimeState;
};

export type AiWorldReflectionCycleStatus =
  | "no_due"
  | "success_cooldown"
  | "retry_backoff"
  | "daily_budget"
  | "processing"
  | "reconciled"
  | "ignored"
  | "recorded"
  | "provider_failed";

export interface AiWorldReflectionCycleResult {
  status: AiWorldReflectionCycleStatus;
  attempted: boolean;
  sourceKey?: string;
  reflectionThreadId?: string;
  error?: string;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function isoAfter(asOf: string, deltaMs: number): string {
  return new Date(timestamp(asOf, "reflection asOf") + deltaMs).toISOString();
}

function utcDay(asOf: string): string {
  return new Date(timestamp(asOf, "reflection asOf")).toISOString().slice(0, 10);
}

function sourceKey(due: AiWorldDueReview): string {
  return `${due.recordType}:${due.recordId}:${due.nextReviewAt}`;
}

function basisRef(due: AiWorldDueReview): string {
  return `ai-world-review:${sourceKey(due)}`;
}

function runtimeState(snapshot: OurHomeData, asOf: string): AiWorldReflectionRuntimeState {
  const data = snapshot as ReflectionStoreData;
  const day = utcDay(asOf);
  const current = data.aiWorldReflectionRuntime;
  if (!current) return { utcDay: day, attemptsToday: 0 };
  if (!Number.isInteger(current.attemptsToday) || current.attemptsToday < 0) {
    throw new Error("AI World reflection attemptsToday is invalid");
  }
  if (current.lastCompletedAt) timestamp(current.lastCompletedAt, "reflection lastCompletedAt");
  if (current.retryAfter) timestamp(current.retryAfter, "reflection retryAfter");
  if (current.processing) {
    timestamp(current.processing.startedAt, "reflection processing startedAt");
    timestamp(current.processing.leaseUntil, "reflection processing leaseUntil");
    if (!current.processing.sourceKey) throw new Error("AI World reflection processing sourceKey is invalid");
  }
  if (current.utcDay !== day) return { utcDay: day, attemptsToday: 0 };
  return structuredClone(current);
}

function reflectionSource(store: JsonStore, due: AiWorldDueReview): AiWorldReflectionSource {
  const continuity = readAiWorldContinuity(store);
  if (due.recordType === "experience") {
    const item = continuity.experiences.find((entry) => entry.id === due.recordId);
    if (!item || item.nextReviewAt !== due.nextReviewAt) throw new Error("Reflection source changed before evaluation");
    return {
      recordType: due.recordType,
      recordId: item.id,
      dueAt: due.nextReviewAt,
      provenance: item.provenance,
      summary: item.summary.slice(0, 5_000),
      ...(item.evidenceRefs ? { evidenceRefs: [...item.evidenceRefs] } : {}),
    };
  }
  if (due.recordType === "note") {
    const item = continuity.notes.find((entry) => entry.id === due.recordId);
    if (!item || item.nextReviewAt !== due.nextReviewAt) throw new Error("Reflection source changed before evaluation");
    return {
      recordType: due.recordType,
      recordId: item.id,
      dueAt: due.nextReviewAt,
      provenance: item.provenance,
      title: item.title,
      summary: item.body.slice(0, 5_000),
      ...(item.evidenceRefs ? { evidenceRefs: [...item.evidenceRefs] } : {}),
    };
  }
  const item = continuity.thoughtThreads.find((entry) => entry.id === due.recordId);
  if (!item || item.status === "archived" || item.nextReviewAt !== due.nextReviewAt) {
    throw new Error("Reflection source changed before evaluation");
  }
  return {
    recordType: due.recordType,
    recordId: item.id,
    dueAt: due.nextReviewAt,
    provenance: item.provenance,
    title: item.title,
    summary: item.summary,
    ...(item.conclusion ? { conclusion: item.conclusion } : {}),
    ...(item.openQuestion ? { openQuestion: item.openQuestion } : {}),
    ...(item.evidenceRefs ? { evidenceRefs: [...item.evidenceRefs] } : {}),
  };
}

function reflectionInput(store: JsonStore, due: AiWorldDueReview, asOf: string): AiWorldReflectionInput {
  const snapshot = store.snapshot();
  if (!snapshot.aiWorld) throw new Error("AI World must be initialized before reflection");
  const state = snapshot.aiWorld.state;
  const soul = listAiWorldSoulTendencies(store)
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score)
      || left.interestKey.localeCompare(right.interestKey))
    .slice(0, MAX_REFLECTION_SOUL_CONTEXT)
    .map((item) => ({ interestKey: item.interestKey, score: item.score, updatedAt: item.updatedAt }));
  return {
    asOf,
    source: reflectionSource(store, due),
    aiWorldState: {
      location: state.location,
      room: state.room,
      weather: state.weather,
      workState: state.workState,
      currentActivity: state.currentActivity,
      phaseKey: state.phaseKey,
      updatedAt: state.updatedAt,
    },
    soul,
  };
}

function existingReflectionThreadId(store: JsonStore, due: AiWorldDueReview): string | undefined {
  const ref = basisRef(due);
  return readAiWorldContinuity(store).thoughtThreads
    .find((thread) => thread.evidenceRefs?.includes(ref))?.id;
}

async function rescheduleSource(store: JsonStore, due: AiWorldDueReview, asOf: string, delayMs: number): Promise<void> {
  // Re-check the exact source/due binding before mutation. Brain cannot retarget this record.
  reflectionSource(store, due);
  const nextReviewAt = isoAfter(asOf, delayMs);
  if (due.recordType === "experience") {
    await reviewAiWorldExperience(store, due.recordId, nextReviewAt, asOf);
  } else if (due.recordType === "note") {
    await updateAiWorldNote(store, due.recordId, { nextReviewAt }, asOf);
  } else {
    await updateAiWorldThoughtThread(store, due.recordId, { nextReviewAt }, asOf);
  }
}

async function claimAttempt(store: JsonStore, due: AiWorldDueReview, asOf: string): Promise<void> {
  const day = utcDay(asOf);
  await store.update((raw) => {
    const data = raw as ReflectionStoreData;
    const current = runtimeState(data, asOf);
    data.aiWorldReflectionRuntime = {
      ...current,
      utcDay: day,
      attemptsToday: current.attemptsToday + 1,
      processing: {
        sourceKey: sourceKey(due),
        startedAt: asOf,
        leaseUntil: isoAfter(asOf, REFLECTION_PROCESSING_LEASE_MS),
      },
    };
  });
}

async function markFailure(store: JsonStore, due: AiWorldDueReview, asOf: string): Promise<void> {
  await store.update((raw) => {
    const data = raw as ReflectionStoreData;
    const current = runtimeState(data, asOf);
    data.aiWorldReflectionRuntime = {
      ...current,
      processing: undefined,
      retryAfter: isoAfter(asOf, REFLECTION_FAILURE_BACKOFF_MS),
    };
    if (data.aiWorldReflectionRuntime.processing?.sourceKey === sourceKey(due)) {
      data.aiWorldReflectionRuntime.processing = undefined;
    }
  });
}

async function markCompleted(store: JsonStore, asOf: string): Promise<void> {
  await store.update((raw) => {
    const data = raw as ReflectionStoreData;
    const current = runtimeState(data, asOf);
    data.aiWorldReflectionRuntime = {
      ...current,
      processing: undefined,
      retryAfter: undefined,
      lastCompletedAt: asOf,
    };
  });
}

function gateStatus(store: JsonStore, asOf: string): Exclude<AiWorldReflectionCycleStatus, "no_due" | "reconciled" | "ignored" | "recorded" | "provider_failed"> | undefined {
  const now = timestamp(asOf, "reflection asOf");
  const state = runtimeState(store.snapshot(), asOf);
  if (state.processing && timestamp(state.processing.leaseUntil, "reflection processing leaseUntil") > now) return "processing";
  if (state.retryAfter && timestamp(state.retryAfter, "reflection retryAfter") > now) return "retry_backoff";
  if (state.lastCompletedAt && now - timestamp(state.lastCompletedAt, "reflection lastCompletedAt") < REFLECTION_SUCCESS_COOLDOWN_MS) {
    return "success_cooldown";
  }
  if (state.attemptsToday >= REFLECTION_DAILY_ATTEMPT_LIMIT) return "daily_budget";
  return undefined;
}

export function readAiWorldReflectionRuntimeState(store: JsonStore, asOf = new Date().toISOString()): AiWorldReflectionRuntimeState {
  return runtimeState(store.snapshot(), asOf);
}

/**
 * Runs at most one bounded AI World reflection attempt.
 * There is no Earth context and no action capable of mutating Soul, notifying the user, or operating Android.
 */
export async function runAiWorldReflectionCycle(
  store: JsonStore,
  adapter: AiWorldReflectionAdapter,
  asOf = new Date().toISOString(),
): Promise<AiWorldReflectionCycleResult> {
  timestamp(asOf, "reflection asOf");
  const due = listDueAiWorldReviews(store, asOf, 1)[0];
  if (!due) return { status: "no_due", attempted: false };
  const key = sourceKey(due);

  const blocked = gateStatus(store, asOf);
  if (blocked) return { status: blocked, attempted: false, sourceKey: key };

  // Crash-recovery/idempotency: if content for this exact review basis already exists,
  // finish the deterministic source lifecycle without another model call.
  const existingThreadId = existingReflectionThreadId(store, due);
  if (existingThreadId) {
    await rescheduleSource(store, due, asOf, REFLECTION_RECORD_RESCHEDULE_MS);
    await markCompleted(store, asOf);
    return { status: "reconciled", attempted: false, sourceKey: key, reflectionThreadId: existingThreadId };
  }

  await claimAttempt(store, due, asOf);
  try {
    const input = reflectionInput(store, due, asOf);
    const parsed = reflectionDecisionSchema.safeParse(await adapter.evaluate(input));
    if (!parsed.success) throw new Error("Reflection provider violated the bounded decision contract");

    if (parsed.data.action === "ignore") {
      await rescheduleSource(store, due, asOf, REFLECTION_IGNORE_RESCHEDULE_MS);
      await markCompleted(store, asOf);
      return { status: "ignored", attempted: true, sourceKey: key };
    }

    const ref = basisRef(due);
    const alreadyCreated = existingReflectionThreadId(store, due);
    const thread = alreadyCreated
      ? { id: alreadyCreated }
      : await addAiWorldThoughtThread(store, {
        title: parsed.data.reflection.title,
        summary: parsed.data.reflection.summary,
        ...(parsed.data.reflection.conclusion ? { conclusion: parsed.data.reflection.conclusion } : {}),
        ...(parsed.data.reflection.openQuestion ? { openQuestion: parsed.data.reflection.openQuestion } : {}),
        provenance: "model_generated",
        evidenceRefs: [ref],
      }, asOf);
    await rescheduleSource(store, due, asOf, REFLECTION_RECORD_RESCHEDULE_MS);
    await markCompleted(store, asOf);
    return { status: "recorded", attempted: true, sourceKey: key, reflectionThreadId: thread.id };
  } catch (error) {
    await markFailure(store, due, asOf);
    const message = error instanceof Error ? error.message : "Unknown reflection provider error";
    return { status: "provider_failed", attempted: true, sourceKey: key, error: message };
  }
}

/** Generic provider-neutral webhook adapter for deployments that do not use Hermes. */
export class WebhookReflectionEngine implements AiWorldReflectionAdapter {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async evaluate(input: AiWorldReflectionInput): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Reflection engine returned HTTP ${response.status}`);
    return response.json();
  }
}
