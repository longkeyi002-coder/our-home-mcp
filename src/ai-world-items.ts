import { randomUUID } from "node:crypto";
import type { JsonStore } from "./store.js";
import type {
  AiWorldItem,
  AiWorldItemKind,
  AiWorldItemProvenance,
  AiWorldItemStatus,
} from "./types.js";
import { assertValidAiWorldData } from "./ai-world.js";
import { assertValidRecordBoundary } from "./record-boundary.js";

const ITEM_KINDS = new Set<AiWorldItemKind>(["task", "waiting", "plan", "hobby", "interest", "collection"]);
const ITEM_STATUSES = new Set<AiWorldItemStatus>(["active", "completed", "archived"]);
const ITEM_PROVENANCES = new Set<AiWorldItemProvenance>(["inferred", "simulated", "authored", "model_generated"]);

function assertTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid AI World item timestamp: ${value}`);
  return parsed;
}

function assertKind(kind: AiWorldItemKind): void {
  if (!ITEM_KINDS.has(kind)) throw new Error(`Invalid AI World item kind: ${kind}`);
}

function assertStatus(status: AiWorldItemStatus): void {
  if (!ITEM_STATUSES.has(status)) throw new Error(`Invalid AI World item status: ${status}`);
}

function assertProvenance(provenance: AiWorldItemProvenance): void {
  if (!ITEM_PROVENANCES.has(provenance)) throw new Error(`Invalid AI World item provenance: ${provenance}`);
  assertValidRecordBoundary({ world: "AI_WORLD", provenance });
}

export async function addAiWorldItem(
  store: JsonStore,
  input: {
    kind: AiWorldItemKind;
    title: string;
    note?: string;
    provenance: AiWorldItemProvenance;
    status?: AiWorldItemStatus;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldItem> {
  assertKind(input.kind);
  assertProvenance(input.provenance);
  const status = input.status ?? "active";
  assertStatus(status);
  assertTimestamp(asOf);
  const title = input.title.trim();
  if (!title) throw new Error("AI World item title cannot be empty");

  const item: AiWorldItem = {
    id: randomUUID(),
    world: "AI_WORLD",
    provenance: input.provenance,
    source: "AGENT_LIFE",
    kind: input.kind,
    title,
    ...(input.note === undefined ? {} : { note: input.note }),
    status,
    createdAt: asOf,
    updatedAt: asOf,
  };

  await store.update((data) => {
    if (!data.aiWorld) throw new Error("AI World must be initialized before adding continuity items");
    assertValidAiWorldData(data.aiWorld);
    data.aiWorld.items ??= [];
    data.aiWorld.items.unshift(item);
  });
  return structuredClone(item);
}

export async function updateAiWorldItem(
  store: JsonStore,
  id: string,
  patch: {
    title?: string;
    note?: string | null;
    status?: AiWorldItemStatus;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldItem> {
  const atMs = assertTimestamp(asOf);
  if (patch.status !== undefined) assertStatus(patch.status);
  if (patch.title !== undefined && !patch.title.trim()) throw new Error("AI World item title cannot be empty");

  let result: AiWorldItem | undefined;
  await store.update((data) => {
    if (!data.aiWorld) throw new Error("AI World is not initialized");
    assertValidAiWorldData(data.aiWorld);
    const item = (data.aiWorld.items ?? []).find((candidate) => candidate.id === id);
    if (!item) throw new Error(`AI World item not found: ${id}`);
    if (atMs < assertTimestamp(item.createdAt)) throw new Error("AI World item update cannot precede creation");

    if (patch.title !== undefined) item.title = patch.title.trim();
    if (patch.note === null) item.note = undefined;
    else if (patch.note !== undefined) item.note = patch.note;
    if (patch.status !== undefined) item.status = patch.status;
    item.updatedAt = asOf;
    // No API field exists for world/provenance/source/kind, so lifecycle edits cannot reclassify truth.
    result = item;
  });
  if (!result) throw new Error(`AI World item not found: ${id}`);
  return structuredClone(result);
}

export function listAiWorldItems(
  store: JsonStore,
  filter: {
    kind?: AiWorldItemKind;
    status?: AiWorldItemStatus;
    limit?: number;
  } = {},
): AiWorldItem[] {
  if (filter.kind !== undefined) assertKind(filter.kind);
  if (filter.status !== undefined) assertStatus(filter.status);
  const limit = filter.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("AI World item limit must be an integer from 1 to 200");
  }

  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) return [];
  assertValidAiWorldData(aiWorld);
  return (aiWorld.items ?? [])
    .filter((item) => !filter.kind || item.kind === filter.kind)
    .filter((item) => !filter.status || item.status === filter.status)
    .slice(0, limit)
    .map((item) => structuredClone(item));
}
