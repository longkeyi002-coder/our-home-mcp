import { z } from "zod";
import { assertValidAiWorldData } from "./ai-world.js";
import type { JsonStore } from "./store.js";
import type { AiWorldState } from "./types.js";

export const EXPLORATION_SUCCESS_COOLDOWN_MS = 6 * 60 * 60_000;
export const EXPLORATION_FAILURE_BACKOFF_MS = 60 * 60_000;
export const EXPLORATION_MAX_ATTEMPTS_PER_UTC_DAY = 2;
export const EXPLORATION_PROCESSING_LEASE_MS = 20 * 60_000;
export const EXPLORATION_MAX_SOURCES = 5;

const EXPLORABLE_ITEM_KINDS = new Set(["question", "interest", "hobby", "idea"] as const);

type ExplorationItemKind = "question" | "interest" | "hobby" | "idea";

export interface AiWorldExplorationTopic {
  sourceType: "thought_thread" | "item";
  sourceId: string;
  sourceKind: "open_question" | ExplorationItemKind;
  text: string;
  topicKey: string;
}

export interface AiWorldExplorationInput {
  topic: AiWorldExplorationTopic;
  aiWorld: {
    observedAt: string;
    state: AiWorldState;
  };
  capability: {
    publicWebOnly: true;
    authenticatedSessions: false;
    externalSideEffects: false;
    maxSources: typeof EXPLORATION_MAX_SOURCES;
  };
}

export interface AiWorldExplorationSource {
  url: string;
  title: string;
  summary: string;
}

export type AiWorldExplorationResult =
  | { status: "completed"; sources: AiWorldExplorationSource[] }
  | { status: "no_result"; sources: [] };

export interface AiWorldExplorationAdapter {
  explore(input: AiWorldExplorationInput): Promise<unknown>;
}

export type AiWorldExplorationCycleStatus =
  | "disabled"
  | "uninitialized"
  | "not_free_time"
  | "no_topic"
  | "busy"
  | "cooldown"
  | "backoff"
  | "daily_budget"
  | "completed"
  | "no_result"
  | "provider_failed"
  | "contract_failed";

export interface AiWorldExplorationCycleResult {
  status: AiWorldExplorationCycleStatus;
  attempted: boolean;
  topic?: AiWorldExplorationTopic;
  result?: AiWorldExplorationResult;
}

interface AiWorldExplorationRuntimeState {
  attemptDay?: string;
  attemptsToday?: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  failureBackoffUntil?: string;
  processingAt?: string;
  processingTopicKey?: string;
}

type StoreWithExplorationRuntime = ReturnType<JsonStore["snapshot"]> & {
  aiWorldExplorationRuntime?: AiWorldExplorationRuntimeState;
};

const sourceSchema = z.object({
  url: z.string().trim().min(1).max(2_000).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Exploration source must be a public HTTP(S) URL without embedded credentials"),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(2_000),
}).strict();

const explorationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    sources: z.array(sourceSchema).min(1).max(EXPLORATION_MAX_SOURCES),
  }).strict(),
  z.object({
    status: z.literal("no_result"),
    sources: z.tuple([]),
  }).strict(),
]);

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function boundedTopicText(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Exploration topic cannot be empty");
  return normalized.slice(0, 1_000);
}

function utcDay(asOf: string): string {
  return asOf.slice(0, 10);
}

function assertRuntimeState(state: AiWorldExplorationRuntimeState): void {
  if (state.attemptDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(state.attemptDay)) {
    throw new Error("AI World exploration runtime has invalid attemptDay");
  }
  if (state.attemptsToday !== undefined && (!Number.isInteger(state.attemptsToday) || state.attemptsToday < 0 || state.attemptsToday > EXPLORATION_MAX_ATTEMPTS_PER_UTC_DAY)) {
    throw new Error("AI World exploration runtime has invalid attemptsToday");
  }
  for (const [label, value] of [
    ["lastAttemptAt", state.lastAttemptAt],
    ["lastSuccessAt", state.lastSuccessAt],
    ["failureBackoffUntil", state.failureBackoffUntil],
    ["processingAt", state.processingAt],
  ] as const) {
    if (value !== undefined) timestamp(value, `exploration runtime ${label}`);
  }
  if ((state.processingAt === undefined) !== (state.processingTopicKey === undefined)) {
    throw new Error("AI World exploration runtime has a partial processing lease");
  }
}

function readRuntimeState(store: JsonStore): AiWorldExplorationRuntimeState {
  const state = (store.snapshot() as StoreWithExplorationRuntime).aiWorldExplorationRuntime ?? {};
  assertRuntimeState(state);
  return structuredClone(state);
}

function topicCandidates(store: JsonStore): AiWorldExplorationTopic[] {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) return [];
  assertValidAiWorldData(aiWorld);

  const candidates: Array<AiWorldExplorationTopic & { priority: number; createdAt: string }> = [];
  for (const thread of aiWorld.continuity?.thoughtThreads ?? []) {
    if (thread.status !== "active" || !thread.openQuestion) continue;
    candidates.push({
      sourceType: "thought_thread",
      sourceId: thread.id,
      sourceKind: "open_question",
      text: boundedTopicText(thread.openQuestion),
      topicKey: `thought_thread:${thread.id}:open_question`,
      priority: 0,
      createdAt: thread.createdAt,
    });
  }

  const itemPriority: Record<ExplorationItemKind, number> = {
    question: 1,
    interest: 2,
    hobby: 3,
    idea: 4,
  };
  for (const item of aiWorld.items ?? []) {
    if (item.status !== "active" || !EXPLORABLE_ITEM_KINDS.has(item.kind as ExplorationItemKind)) continue;
    const kind = item.kind as ExplorationItemKind;
    candidates.push({
      sourceType: "item",
      sourceId: item.id,
      sourceKind: kind,
      text: boundedTopicText(item.note ? `${item.title}: ${item.note}` : item.title),
      topicKey: `item:${item.id}:${kind}`,
      priority: itemPriority[kind],
      createdAt: item.createdAt,
    });
  }

  return candidates
    .sort((left, right) => left.priority - right.priority
      || left.createdAt.localeCompare(right.createdAt)
      || left.topicKey.localeCompare(right.topicKey))
    .map(({ priority: _priority, createdAt: _createdAt, ...topic }) => topic);
}

export function selectAiWorldExplorationTopic(store: JsonStore): AiWorldExplorationTopic | undefined {
  return topicCandidates(store)[0];
}

export function getAiWorldExplorationRuntimeState(store: JsonStore): AiWorldExplorationRuntimeState {
  return readRuntimeState(store);
}

/**
 * P5.1 capability boundary only: this does not persist web findings into canonical AI World
 * memory and cannot create messages or external side effects. A later P5 stage may consume the
 * structured result through separate, reviewed persistence/share-intent paths.
 */
export async function runAiWorldExplorationCycle(
  store: JsonStore,
  adapter: AiWorldExplorationAdapter,
  asOf = new Date().toISOString(),
  enabled = false,
): Promise<AiWorldExplorationCycleResult> {
  const asOfMs = timestamp(asOf, "exploration asOf");
  if (!enabled) return { status: "disabled", attempted: false };

  const snapshot = store.snapshot();
  if (!snapshot.aiWorld) return { status: "uninitialized", attempted: false };
  assertValidAiWorldData(snapshot.aiWorld);
  if (snapshot.aiWorld.state.currentActivity !== "free_time") {
    return { status: "not_free_time", attempted: false };
  }

  const topic = selectAiWorldExplorationTopic(store);
  if (!topic) return { status: "no_topic", attempted: false };

  let blocked: Exclude<AiWorldExplorationCycleStatus, "disabled" | "uninitialized" | "not_free_time" | "no_topic" | "completed" | "no_result" | "provider_failed" | "contract_failed"> | undefined;
  let claimed = false;
  await store.update((data) => {
    const extended = data as StoreWithExplorationRuntime;
    const state = extended.aiWorldExplorationRuntime ??= {};
    assertRuntimeState(state);

    const day = utcDay(asOf);
    if (state.attemptDay !== day) {
      state.attemptDay = day;
      state.attemptsToday = 0;
    }

    if (state.processingAt) {
      const processingAtMs = timestamp(state.processingAt, "exploration processingAt");
      if (asOfMs - processingAtMs < EXPLORATION_PROCESSING_LEASE_MS) {
        blocked = "busy";
        return;
      }
      state.processingAt = undefined;
      state.processingTopicKey = undefined;
    }

    if (state.lastSuccessAt && asOfMs - timestamp(state.lastSuccessAt, "exploration lastSuccessAt") < EXPLORATION_SUCCESS_COOLDOWN_MS) {
      blocked = "cooldown";
      return;
    }
    if (state.failureBackoffUntil && asOfMs < timestamp(state.failureBackoffUntil, "exploration failureBackoffUntil")) {
      blocked = "backoff";
      return;
    }
    if ((state.attemptsToday ?? 0) >= EXPLORATION_MAX_ATTEMPTS_PER_UTC_DAY) {
      blocked = "daily_budget";
      return;
    }

    state.attemptsToday = (state.attemptsToday ?? 0) + 1;
    state.lastAttemptAt = asOf;
    state.processingAt = asOf;
    state.processingTopicKey = topic.topicKey;
    state.failureBackoffUntil = undefined;
    claimed = true;
  });

  if (!claimed) return { status: blocked ?? "busy", attempted: false, topic };

  const input: AiWorldExplorationInput = {
    topic: structuredClone(topic),
    aiWorld: {
      observedAt: asOf,
      state: structuredClone(snapshot.aiWorld.state),
    },
    capability: {
      publicWebOnly: true,
      authenticatedSessions: false,
      externalSideEffects: false,
      maxSources: EXPLORATION_MAX_SOURCES,
    },
  };

  let rawResult: unknown;
  try {
    rawResult = await adapter.explore(input);
  } catch {
    await store.update((data) => {
      const state = (data as StoreWithExplorationRuntime).aiWorldExplorationRuntime;
      if (!state || state.processingTopicKey !== topic.topicKey || state.processingAt !== asOf) return;
      state.processingAt = undefined;
      state.processingTopicKey = undefined;
      state.failureBackoffUntil = new Date(asOfMs + EXPLORATION_FAILURE_BACKOFF_MS).toISOString();
    });
    return { status: "provider_failed", attempted: true, topic };
  }

  const parsed = explorationResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    await store.update((data) => {
      const state = (data as StoreWithExplorationRuntime).aiWorldExplorationRuntime;
      if (!state || state.processingTopicKey !== topic.topicKey || state.processingAt !== asOf) return;
      state.processingAt = undefined;
      state.processingTopicKey = undefined;
      state.failureBackoffUntil = new Date(asOfMs + EXPLORATION_FAILURE_BACKOFF_MS).toISOString();
    });
    return { status: "contract_failed", attempted: true, topic };
  }

  const result = parsed.data as AiWorldExplorationResult;
  await store.update((data) => {
    const state = (data as StoreWithExplorationRuntime).aiWorldExplorationRuntime;
    if (!state || state.processingTopicKey !== topic.topicKey || state.processingAt !== asOf) {
      throw new Error("AI World exploration processing lease changed before completion");
    }
    state.processingAt = undefined;
    state.processingTopicKey = undefined;
    state.lastSuccessAt = asOf;
    state.failureBackoffUntil = undefined;
  });

  return { status: result.status, attempted: true, topic, result };
}
