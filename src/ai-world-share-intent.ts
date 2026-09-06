import { createHash } from "node:crypto";
import { z } from "zod";
import { assertValidAiWorldData } from "./ai-world.js";
import type { JsonStore } from "./store.js";
import type { OurHomeData } from "./types.js";

export type AiWorldShareIntentStatus = "pending" | "dismissed" | "consumed";
export type AiWorldShareIntentBasisType = "experience" | "collection" | "thought_thread";

export interface AiWorldShareIntent {
  id: string;
  kind: "maybe_share";
  world: "AI_WORLD";
  provenance: "inferred";
  source: "AGENT_LIFE";
  basisType: AiWorldShareIntentBasisType;
  basisId: string;
  basisKey: string;
  title: string;
  summary: string;
  evidenceRefs: string[];
  status: AiWorldShareIntentStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export const MAX_PENDING_AI_WORLD_SHARE_INTENTS = 5;
const MAX_STORED_AI_WORLD_SHARE_INTENTS = 100;

const createInputSchema = z.object({
  basisType: z.enum(["experience", "collection", "thought_thread"]),
  basisId: z.string().trim().min(1).max(500),
}).strict();

const resolveInputSchema = z.object({
  status: z.enum(["dismissed", "consumed"]),
}).strict();

type ShareIntentStoreData = OurHomeData & {
  /** AI World semantic communication intents. They are not Earth proactive messages. */
  aiWorldShareIntents?: AiWorldShareIntent[];
};

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function bounded(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty`);
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertIntent(intent: AiWorldShareIntent): void {
  if (intent.kind !== "maybe_share" || intent.world !== "AI_WORLD" || intent.provenance !== "inferred" || intent.source !== "AGENT_LIFE") {
    throw new Error("AI World share intent has an invalid world boundary");
  }
  if (!intent.id || !intent.basisId || !intent.basisKey || !intent.title.trim() || !intent.summary.trim()) {
    throw new Error("AI World share intent has invalid structured fields");
  }
  if (!["experience", "collection", "thought_thread"].includes(intent.basisType)) {
    throw new Error("AI World share intent has an invalid basis type");
  }
  if (!["pending", "dismissed", "consumed"].includes(intent.status)) {
    throw new Error("AI World share intent has an invalid status");
  }
  const createdAt = timestamp(intent.createdAt, "share intent createdAt");
  if (timestamp(intent.updatedAt, "share intent updatedAt") < createdAt) {
    throw new Error("AI World share intent updatedAt cannot precede creation");
  }
  if (intent.status === "pending" && intent.resolvedAt !== undefined) {
    throw new Error("Pending AI World share intent cannot have resolvedAt");
  }
  if (intent.status !== "pending") {
    if (!intent.resolvedAt || timestamp(intent.resolvedAt, "share intent resolvedAt") < createdAt) {
      throw new Error("Resolved AI World share intent requires a valid resolvedAt");
    }
  }
  if (!Array.isArray(intent.evidenceRefs) || intent.evidenceRefs.length < 1 || intent.evidenceRefs.length > 50) {
    throw new Error("AI World share intent evidenceRefs must be a bounded non-empty array");
  }
  for (const ref of intent.evidenceRefs) {
    if (typeof ref !== "string" || !ref.trim() || ref.length > 500) {
      throw new Error("AI World share intent contains an invalid evidence reference");
    }
  }
}

function readMemory(store: JsonStore): AiWorldShareIntent[] {
  const data = store.snapshot() as ShareIntentStoreData;
  const intents = data.aiWorldShareIntents ?? [];
  if (!Array.isArray(intents)) throw new Error("AI World share intents must be an array");
  const ids = new Set<string>();
  const basisKeys = new Set<string>();
  let pending = 0;
  for (const intent of intents) {
    assertIntent(intent);
    if (ids.has(intent.id)) throw new Error("Duplicate AI World share intent id");
    if (basisKeys.has(intent.basisKey)) throw new Error("Duplicate AI World share intent basis");
    ids.add(intent.id);
    basisKeys.add(intent.basisKey);
    if (intent.status === "pending") pending += 1;
  }
  if (pending > MAX_PENDING_AI_WORLD_SHARE_INTENTS) {
    throw new Error("AI World pending share intent limit exceeded");
  }
  if (intents.length > MAX_STORED_AI_WORLD_SHARE_INTENTS) {
    throw new Error("AI World share intent history limit exceeded");
  }
  return structuredClone(intents);
}

function basisSnapshot(
  store: JsonStore,
  basisType: AiWorldShareIntentBasisType,
  basisId: string,
): { title: string; summary: string; evidenceRefs: string[] } {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) throw new Error("AI World must be initialized before creating a share intent");
  assertValidAiWorldData(aiWorld);

  if (basisType === "experience") {
    const experience = aiWorld.continuity?.experiences.find((item) => item.id === basisId);
    if (!experience || !experience.id.startsWith("ai-world:exploration-experience:")) {
      throw new Error("Share-intent experience basis must be a persisted exploration experience");
    }
    const refs = experience.evidenceRefs ?? [];
    if (!refs.some((ref) => ref.startsWith("exploration-topic:")) || !refs.some((ref) => ref.startsWith("public-web:"))) {
      throw new Error("Exploration experience basis lacks traceable public-Web evidence");
    }
    return {
      title: "想和你分享我看到的东西",
      summary: bounded(experience.summary, "share intent summary", 2_000),
      evidenceRefs: [`ai-world-experience:${experience.id}`, ...refs].slice(0, 50),
    };
  }

  if (basisType === "collection") {
    const collection = (aiWorld.items ?? []).find((item) => item.id === basisId);
    if (!collection || collection.kind !== "collection" || collection.status !== "active"
      || collection.provenance !== "model_generated" || !collection.id.startsWith("ai-world:exploration-source:")) {
      throw new Error("Share-intent collection basis must be an active exploration collection");
    }
    return {
      title: bounded(collection.title, "share intent title", 300),
      summary: bounded(collection.note ?? collection.title, "share intent summary", 2_000),
      evidenceRefs: [`ai-world-collection:${collection.id}`],
    };
  }

  const thread = aiWorld.continuity?.thoughtThreads.find((item) => item.id === basisId);
  if (!thread || thread.status === "archived" || thread.provenance !== "model_generated"
    || !thread.evidenceRefs?.some((ref) => ref.startsWith("ai-world-review:"))) {
    throw new Error("Share-intent thought-thread basis must be a traceable reflection output");
  }
  return {
    title: bounded(thread.title, "share intent title", 300),
    summary: bounded(thread.conclusion ?? thread.summary, "share intent summary", 2_000),
    evidenceRefs: [`ai-world-thought-thread:${thread.id}`, ...(thread.evidenceRefs ?? [])].slice(0, 50),
  };
}

export function listAiWorldShareIntents(
  store: JsonStore,
  status?: AiWorldShareIntentStatus,
): AiWorldShareIntent[] {
  const intents = readMemory(store);
  return intents
    .filter((intent) => status === undefined || intent.status === status)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export async function createAiWorldShareIntent(
  store: JsonStore,
  rawInput: unknown,
  asOf = new Date().toISOString(),
): Promise<{ intent: AiWorldShareIntent; duplicate: boolean }> {
  timestamp(asOf, "share intent asOf");
  const input = createInputSchema.parse(rawInput);
  const basisKey = `${input.basisType}:${input.basisId}`;
  const existing = readMemory(store).find((intent) => intent.basisKey === basisKey);
  if (existing) return { intent: existing, duplicate: true };

  const basis = basisSnapshot(store, input.basisType, input.basisId);
  const pendingCount = readMemory(store).filter((intent) => intent.status === "pending").length;
  if (pendingCount >= MAX_PENDING_AI_WORLD_SHARE_INTENTS) {
    throw new Error("AI World has reached the pending maybe-share limit; resolve an existing intent first");
  }

  const intent: AiWorldShareIntent = {
    id: `ai-world:maybe-share:${hash(basisKey)}`,
    kind: "maybe_share",
    world: "AI_WORLD",
    provenance: "inferred",
    source: "AGENT_LIFE",
    basisType: input.basisType,
    basisId: input.basisId,
    basisKey,
    title: basis.title,
    summary: basis.summary,
    evidenceRefs: [...new Set(basis.evidenceRefs)],
    status: "pending",
    createdAt: asOf,
    updatedAt: asOf,
  };
  assertIntent(intent);

  let result: AiWorldShareIntent | undefined;
  let duplicate = false;
  await store.update((raw) => {
    const data = raw as ShareIntentStoreData;
    data.aiWorldShareIntents ??= [];
    const already = data.aiWorldShareIntents.find((candidate) => candidate.basisKey === basisKey);
    if (already) {
      result = already;
      duplicate = true;
      return;
    }
    const pending = data.aiWorldShareIntents.filter((candidate) => candidate.status === "pending").length;
    if (pending >= MAX_PENDING_AI_WORLD_SHARE_INTENTS) {
      throw new Error("AI World has reached the pending maybe-share limit; resolve an existing intent first");
    }
    data.aiWorldShareIntents.unshift(intent);
    if (data.aiWorldShareIntents.length > MAX_STORED_AI_WORLD_SHARE_INTENTS) {
      const removable = data.aiWorldShareIntents
        .map((candidate, index) => ({ candidate, index }))
        .reverse()
        .find(({ candidate }) => candidate.status !== "pending");
      if (!removable) throw new Error("AI World share-intent history is full of unresolved intents");
      data.aiWorldShareIntents.splice(removable.index, 1);
    }
    result = intent;
  });

  if (!result) throw new Error("AI World share intent was not persisted");
  return { intent: structuredClone(result), duplicate };
}

export async function resolveAiWorldShareIntent(
  store: JsonStore,
  id: string,
  rawInput: unknown,
  asOf = new Date().toISOString(),
): Promise<AiWorldShareIntent> {
  const asOfMs = timestamp(asOf, "share intent resolution time");
  const input = resolveInputSchema.parse(rawInput);
  let result: AiWorldShareIntent | undefined;

  await store.update((raw) => {
    const data = raw as ShareIntentStoreData;
    data.aiWorldShareIntents ??= [];
    const intent = data.aiWorldShareIntents.find((candidate) => candidate.id === id);
    if (!intent) throw new Error(`AI World share intent not found: ${id}`);
    assertIntent(intent);
    if (intent.status !== "pending") {
      if (intent.status === input.status) {
        result = intent;
        return;
      }
      throw new Error("Resolved AI World share intent cannot change terminal status");
    }
    if (asOfMs < timestamp(intent.createdAt, "share intent createdAt")) {
      throw new Error("AI World share intent cannot resolve before creation");
    }
    intent.status = input.status;
    intent.updatedAt = asOf;
    intent.resolvedAt = asOf;
    result = intent;
  });

  if (!result) throw new Error(`AI World share intent not found: ${id}`);
  return structuredClone(result);
}
