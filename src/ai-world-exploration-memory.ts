import { createHash } from "node:crypto";
import { z } from "zod";
import { assertValidAiWorldData } from "./ai-world.js";
import {
  EXPLORATION_MAX_SOURCES,
  type AiWorldExplorationAdapter,
  type AiWorldExplorationInput,
  type AiWorldExplorationResult,
  type AiWorldExplorationSource,
  type AiWorldExplorationTopic,
} from "./ai-world-exploration.js";
import type { JsonStore } from "./store.js";
import type { AiWorldExperience, AiWorldItem } from "./types.js";

export const EXPLORATION_REVIEW_DELAY_MS = 12 * 60 * 60_000;

const sourceSchema = z.object({
  url: z.string().trim().min(1).max(2_000).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(2_000),
}).strict();

const resultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), sources: z.array(sourceSchema).min(1).max(EXPLORATION_MAX_SOURCES) }).strict(),
  z.object({ status: z.literal("no_result"), sources: z.tuple([]) }).strict(),
]);

export interface PersistedAiWorldExplorationMemory {
  experience: AiWorldExperience;
  collections: AiWorldItem[];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bounded(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function topicRef(topic: AiWorldExplorationTopic): string {
  return `exploration-topic:${topic.topicKey}`.slice(0, 500);
}

function sourceRef(source: AiWorldExplorationSource): string {
  const direct = `public-web:${source.url}`;
  return direct.length <= 500 ? direct : `public-web-sha256:${hash(source.url)}`;
}

function canonicalSources(sources: AiWorldExplorationSource[]): AiWorldExplorationSource[] {
  const byUrl = new Map<string, AiWorldExplorationSource>();
  for (const source of sources) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }
  return [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url));
}

function assertTopicStillMatches(
  data: ReturnType<JsonStore["snapshot"]>,
  topic: AiWorldExplorationTopic,
): void {
  const aiWorld = data.aiWorld;
  if (!aiWorld) throw new Error("AI World disappeared before exploration persistence");
  assertValidAiWorldData(aiWorld);

  if (topic.sourceType === "thought_thread") {
    const thread = aiWorld.continuity?.thoughtThreads.find((item) => item.id === topic.sourceId);
    if (!thread || thread.status !== "active" || !thread.openQuestion) {
      throw new Error("Exploration topic source is no longer active");
    }
    if (bounded(thread.openQuestion, 1_000) !== topic.text || topic.sourceKind !== "open_question") {
      throw new Error("Exploration topic changed while the provider was running");
    }
    return;
  }

  const item = (aiWorld.items ?? []).find((candidate) => candidate.id === topic.sourceId);
  if (!item || item.status !== "active" || item.kind !== topic.sourceKind) {
    throw new Error("Exploration topic item is no longer active");
  }
  const currentText = bounded(item.note ? `${item.title}: ${item.note}` : item.title, 1_000);
  if (currentText !== topic.text) throw new Error("Exploration topic changed while the provider was running");
}

export async function persistAiWorldExplorationResult(
  store: JsonStore,
  input: AiWorldExplorationInput,
  result: Extract<AiWorldExplorationResult, { status: "completed" }>,
): Promise<PersistedAiWorldExplorationMemory> {
  const asOf = input.aiWorld.observedAt;
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new Error("Exploration persistence requires a valid observedAt");
  const sources = canonicalSources(result.sources);
  const resultKey = hash(`${input.topic.topicKey}\n${sources.map((source) => source.url).join("\n")}`);
  const experienceId = `ai-world:exploration-experience:${resultKey}`;
  const evidenceRefs = [topicRef(input.topic), ...sources.map(sourceRef)];
  const nextReviewAt = new Date(asOfMs + EXPLORATION_REVIEW_DELAY_MS).toISOString();

  let experience: AiWorldExperience | undefined;
  const collections: AiWorldItem[] = [];

  await store.update((data) => {
    assertTopicStillMatches(data, input.topic);
    const aiWorld = data.aiWorld!;
    aiWorld.items ??= [];
    aiWorld.continuity ??= { experiences: [], notes: [], thoughtThreads: [] };

    experience = aiWorld.continuity.experiences.find((item) => item.id === experienceId);
    if (!experience) {
      const sourceTitles = sources.map((source) => source.title).join("; ");
      experience = {
        id: experienceId,
        world: "AI_WORLD",
        provenance: "model_generated",
        source: "AGENT_LIFE",
        summary: bounded(
          `Explored public Web sources for “${input.topic.text}”. Read ${sources.length} source(s): ${sourceTitles}`,
          5_000,
        ),
        occurredAt: asOf,
        createdAt: asOf,
        evidenceRefs,
        nextReviewAt,
      };
      aiWorld.continuity.experiences.unshift(experience);
    }

    for (const source of sources) {
      const id = `ai-world:exploration-source:${hash(`${input.topic.topicKey}\n${source.url}`)}`;
      const note = bounded(
        `Public URL: ${source.url}\nExploration topic: ${input.topic.text}\nProvider summary: ${source.summary}`,
        6_000,
      );
      let collection = aiWorld.items.find((item) => item.id === id);
      if (!collection) {
        collection = {
          id,
          world: "AI_WORLD",
          provenance: "model_generated",
          source: "AGENT_LIFE",
          kind: "collection",
          title: bounded(source.title, 300),
          note,
          status: "active",
          createdAt: asOf,
          updatedAt: asOf,
        };
        aiWorld.items.unshift(collection);
      } else if (collection.title !== bounded(source.title, 300) || collection.note !== note) {
        collection.title = bounded(source.title, 300);
        collection.note = note;
        collection.updatedAt = asOf;
      }
      collections.push(collection);
    }
  });

  if (!experience) throw new Error("Exploration experience was not persisted");
  return {
    experience: structuredClone(experience),
    collections: structuredClone(collections),
  };
}

/**
 * Decorator used by P5.2/P5.3 so accepted memory is written before P5.1 marks the provider call
 * as successful. If persistence throws, P5.1 treats the attempt as failed/backed-off;
 * deterministic ids make a retry idempotent if the process died after memory commit but before
 * success state.
 */
export class PersistingAiWorldExplorationAdapter implements AiWorldExplorationAdapter {
  constructor(
    private readonly store: JsonStore,
    private readonly inner: AiWorldExplorationAdapter,
  ) {}

  async explore(input: AiWorldExplorationInput): Promise<unknown> {
    const raw = await this.inner.explore(input);
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) return raw;
    const result = parsed.data as AiWorldExplorationResult;
    if (result.status === "completed") {
      await persistAiWorldExplorationResult(this.store, input, result);
    }
    return result;
  }
}
