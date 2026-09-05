import { randomUUID } from "node:crypto";
import { assertValidAiWorldData } from "./ai-world.js";
import { assertValidRecordBoundary } from "./record-boundary.js";
import type { JsonStore } from "./store.js";
import type {
  AiWorldContinuityData,
  AiWorldExperience,
  AiWorldItemProvenance,
  AiWorldNote,
  AiWorldNoteKind,
  AiWorldThoughtThread,
  AiWorldThoughtThreadStatus,
} from "./types.js";

export type AiWorldDueReviewType = "experience" | "note" | "thought_thread";

export interface AiWorldDueReview {
  recordType: AiWorldDueReviewType;
  recordId: string;
  nextReviewAt: string;
}

const PROVENANCES = new Set<AiWorldItemProvenance>(["inferred", "simulated", "authored", "model_generated"]);
const NOTE_KINDS = new Set<AiWorldNoteKind>(["note", "journal"]);
const THREAD_STATUSES = new Set<AiWorldThoughtThreadStatus>(["active", "resolved", "archived"]);

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function boundedText(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty`);
  if (trimmed.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return trimmed;
}

function provenance(value: AiWorldItemProvenance): AiWorldItemProvenance {
  if (!PROVENANCES.has(value)) throw new Error(`Invalid AI World continuity provenance: ${value}`);
  assertValidRecordBoundary({ world: "AI_WORLD", provenance: value });
  return value;
}

function evidenceRefs(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.length > 50) throw new Error("AI World continuity evidenceRefs cannot exceed 50 entries");
  const normalized = [...new Set(value.map((item) => boundedText(item, "evidenceRef", 500)))];
  return normalized.length === 0 ? undefined : normalized;
}

/** nextReviewAt is always scheduled from the current lifecycle action, never into its past. */
function reviewAt(value: string | undefined, notBefore: string): string | undefined {
  if (value === undefined) return undefined;
  if (timestamp(value, "nextReviewAt") < timestamp(notBefore, "review baseline")) {
    throw new Error("nextReviewAt cannot precede the current continuity lifecycle time");
  }
  return value;
}

function requireContinuity(store: JsonStore): AiWorldContinuityData {
  const aiWorld = store.snapshot().aiWorld;
  if (!aiWorld) throw new Error("AI World must be initialized before reading continuity records");
  assertValidAiWorldData(aiWorld);
  return structuredClone(aiWorld.continuity ?? { experiences: [], notes: [], thoughtThreads: [] });
}

function ensureContinuity(data: ReturnType<JsonStore["snapshot"]>): AiWorldContinuityData {
  if (!data.aiWorld) throw new Error("AI World must be initialized before writing continuity records");
  assertValidAiWorldData(data.aiWorld);
  data.aiWorld.continuity ??= { experiences: [], notes: [], thoughtThreads: [] };
  return data.aiWorld.continuity;
}

export function readAiWorldContinuity(store: JsonStore): AiWorldContinuityData {
  return requireContinuity(store);
}

export async function addAiWorldExperience(
  store: JsonStore,
  input: {
    summary: string;
    occurredAt: string;
    provenance: AiWorldItemProvenance;
    confidence?: number;
    evidenceRefs?: string[];
    nextReviewAt?: string;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldExperience> {
  const createdAtMs = timestamp(asOf, "experience createdAt");
  if (timestamp(input.occurredAt, "experience occurredAt") > createdAtMs) {
    throw new Error("AI World experience cannot occur after its creation time");
  }
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new Error("AI World experience confidence must be between 0 and 1");
  }
  const refs = evidenceRefs(input.evidenceRefs);
  const nextReviewAt = reviewAt(input.nextReviewAt, asOf);
  const record: AiWorldExperience = {
    id: randomUUID(),
    world: "AI_WORLD",
    provenance: provenance(input.provenance),
    source: "AGENT_LIFE",
    summary: boundedText(input.summary, "AI World experience summary", 5_000),
    occurredAt: input.occurredAt,
    createdAt: asOf,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    ...(refs ? { evidenceRefs: refs } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
  };

  await store.update((data) => {
    ensureContinuity(data).experiences.unshift(record);
  });
  return structuredClone(record);
}

/**
 * Marks an immutable Experience as reviewed and either clears or schedules its next review.
 * Experience content/provenance is deliberately not editable through this lifecycle action.
 */
export async function reviewAiWorldExperience(
  store: JsonStore,
  id: string,
  nextReviewAt: string | null,
  asOf = new Date().toISOString(),
): Promise<AiWorldExperience> {
  const asOfMs = timestamp(asOf, "experience review time");
  const scheduled = nextReviewAt === null ? undefined : reviewAt(nextReviewAt, asOf);
  let result: AiWorldExperience | undefined;
  await store.update((data) => {
    const experience = ensureContinuity(data).experiences.find((item) => item.id === id);
    if (!experience) throw new Error(`AI World experience not found: ${id}`);
    if (asOfMs < timestamp(experience.createdAt, "experience createdAt")) {
      throw new Error("AI World experience review cannot precede creation");
    }
    experience.lastReviewedAt = asOf;
    experience.nextReviewAt = scheduled;
    result = experience;
  });
  if (!result) throw new Error(`AI World experience not found: ${id}`);
  return structuredClone(result);
}

export async function addAiWorldNote(
  store: JsonStore,
  input: {
    kind: AiWorldNoteKind;
    title: string;
    body: string;
    provenance: AiWorldItemProvenance;
    evidenceRefs?: string[];
    nextReviewAt?: string;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldNote> {
  timestamp(asOf, "note createdAt");
  if (!NOTE_KINDS.has(input.kind)) throw new Error(`Invalid AI World note kind: ${input.kind}`);
  const refs = evidenceRefs(input.evidenceRefs);
  const nextReviewAt = reviewAt(input.nextReviewAt, asOf);
  const note: AiWorldNote = {
    id: randomUUID(),
    world: "AI_WORLD",
    provenance: provenance(input.provenance),
    source: "AGENT_LIFE",
    kind: input.kind,
    title: boundedText(input.title, "AI World note title", 300),
    body: boundedText(input.body, "AI World note body", 20_000),
    ...(refs ? { evidenceRefs: refs } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    createdAt: asOf,
    updatedAt: asOf,
  };

  await store.update((data) => {
    ensureContinuity(data).notes.unshift(note);
  });
  return structuredClone(note);
}

export async function updateAiWorldNote(
  store: JsonStore,
  id: string,
  patch: {
    title?: string;
    body?: string;
    evidenceRefs?: string[];
    nextReviewAt?: string | null;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldNote> {
  const asOfMs = timestamp(asOf, "note updatedAt");
  if (patch.title === undefined && patch.body === undefined && patch.evidenceRefs === undefined && patch.nextReviewAt === undefined) {
    throw new Error("AI World note update requires at least one mutable field");
  }
  let result: AiWorldNote | undefined;
  await store.update((data) => {
    const note = ensureContinuity(data).notes.find((item) => item.id === id);
    if (!note) throw new Error(`AI World note not found: ${id}`);
    if (asOfMs < timestamp(note.createdAt, "note createdAt")) throw new Error("AI World note update cannot precede creation");
    if (patch.title !== undefined) note.title = boundedText(patch.title, "AI World note title", 300);
    if (patch.body !== undefined) note.body = boundedText(patch.body, "AI World note body", 20_000);
    if (patch.evidenceRefs !== undefined) note.evidenceRefs = evidenceRefs(patch.evidenceRefs);
    if (patch.nextReviewAt === null) note.nextReviewAt = undefined;
    else if (patch.nextReviewAt !== undefined) note.nextReviewAt = reviewAt(patch.nextReviewAt, asOf);
    note.updatedAt = asOf;
    result = note;
  });
  if (!result) throw new Error(`AI World note not found: ${id}`);
  return structuredClone(result);
}

export async function addAiWorldThoughtThread(
  store: JsonStore,
  input: {
    title: string;
    summary: string;
    conclusion?: string;
    openQuestion?: string;
    provenance: AiWorldItemProvenance;
    evidenceRefs?: string[];
    nextReviewAt?: string;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldThoughtThread> {
  timestamp(asOf, "thought thread createdAt");
  const refs = evidenceRefs(input.evidenceRefs);
  const nextReviewAt = reviewAt(input.nextReviewAt, asOf);
  const thread: AiWorldThoughtThread = {
    id: randomUUID(),
    world: "AI_WORLD",
    provenance: provenance(input.provenance),
    source: "AGENT_LIFE",
    title: boundedText(input.title, "AI World thought thread title", 300),
    summary: boundedText(input.summary, "AI World thought thread summary", 5_000),
    ...(input.conclusion === undefined ? {} : { conclusion: boundedText(input.conclusion, "AI World thought thread conclusion", 5_000) }),
    ...(input.openQuestion === undefined ? {} : { openQuestion: boundedText(input.openQuestion, "AI World thought thread openQuestion", 2_000) }),
    status: "active",
    ...(refs ? { evidenceRefs: refs } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    createdAt: asOf,
    updatedAt: asOf,
  };

  await store.update((data) => {
    ensureContinuity(data).thoughtThreads.unshift(thread);
  });
  return structuredClone(thread);
}

export async function updateAiWorldThoughtThread(
  store: JsonStore,
  id: string,
  patch: {
    title?: string;
    summary?: string;
    conclusion?: string | null;
    openQuestion?: string | null;
    status?: AiWorldThoughtThreadStatus;
    evidenceRefs?: string[];
    nextReviewAt?: string | null;
  },
  asOf = new Date().toISOString(),
): Promise<AiWorldThoughtThread> {
  const asOfMs = timestamp(asOf, "thought thread updatedAt");
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new Error("AI World thought thread update requires at least one mutable field");
  }
  if (patch.status !== undefined && !THREAD_STATUSES.has(patch.status)) {
    throw new Error(`Invalid AI World thought thread status: ${patch.status}`);
  }

  let result: AiWorldThoughtThread | undefined;
  await store.update((data) => {
    const thread = ensureContinuity(data).thoughtThreads.find((item) => item.id === id);
    if (!thread) throw new Error(`AI World thought thread not found: ${id}`);
    if (asOfMs < timestamp(thread.createdAt, "thought thread createdAt")) {
      throw new Error("AI World thought thread update cannot precede creation");
    }
    if (patch.title !== undefined) thread.title = boundedText(patch.title, "AI World thought thread title", 300);
    if (patch.summary !== undefined) thread.summary = boundedText(patch.summary, "AI World thought thread summary", 5_000);
    if (patch.conclusion === null) thread.conclusion = undefined;
    else if (patch.conclusion !== undefined) thread.conclusion = boundedText(patch.conclusion, "AI World thought thread conclusion", 5_000);
    if (patch.openQuestion === null) thread.openQuestion = undefined;
    else if (patch.openQuestion !== undefined) thread.openQuestion = boundedText(patch.openQuestion, "AI World thought thread openQuestion", 2_000);
    if (patch.status !== undefined) thread.status = patch.status;
    if (patch.evidenceRefs !== undefined) thread.evidenceRefs = evidenceRefs(patch.evidenceRefs);
    if (patch.nextReviewAt === null) thread.nextReviewAt = undefined;
    else if (patch.nextReviewAt !== undefined) thread.nextReviewAt = reviewAt(patch.nextReviewAt, asOf);
    thread.updatedAt = asOf;
    result = thread;
  });
  if (!result) throw new Error(`AI World thought thread not found: ${id}`);
  return structuredClone(result);
}

export function listDueAiWorldReviews(
  store: JsonStore,
  asOf = new Date().toISOString(),
  limit = 50,
): AiWorldDueReview[] {
  const asOfMs = timestamp(asOf, "review asOf");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("AI World review limit must be an integer from 1 to 200");
  }
  const continuity = requireContinuity(store);
  const due: AiWorldDueReview[] = [];

  for (const experience of continuity.experiences) {
    if (experience.nextReviewAt && timestamp(experience.nextReviewAt, "experience nextReviewAt") <= asOfMs) {
      due.push({ recordType: "experience", recordId: experience.id, nextReviewAt: experience.nextReviewAt });
    }
  }
  for (const note of continuity.notes) {
    if (note.nextReviewAt && timestamp(note.nextReviewAt, "note nextReviewAt") <= asOfMs) {
      due.push({ recordType: "note", recordId: note.id, nextReviewAt: note.nextReviewAt });
    }
  }
  for (const thread of continuity.thoughtThreads) {
    if (thread.status !== "archived" && thread.nextReviewAt && timestamp(thread.nextReviewAt, "thought thread nextReviewAt") <= asOfMs) {
      due.push({ recordType: "thought_thread", recordId: thread.id, nextReviewAt: thread.nextReviewAt });
    }
  }

  return due
    .sort((left, right) => left.nextReviewAt.localeCompare(right.nextReviewAt)
      || left.recordType.localeCompare(right.recordType)
      || left.recordId.localeCompare(right.recordId))
    .slice(0, limit);
}
