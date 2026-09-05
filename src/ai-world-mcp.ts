import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JsonStore } from "./store.js";
import { addAiWorldItem, listAiWorldItems, updateAiWorldItem } from "./ai-world-items.js";
import { readPersistedAiWorld } from "./ai-world-store.js";

const kindSchema = z.enum(["task", "waiting", "plan", "idea", "question", "hobby", "interest", "collection"]);
const statusSchema = z.enum(["active", "completed", "archived"]);
// MCP callers may author/infer/model-generate semantic continuity. `simulated` is reserved
// for the deterministic AI World state machine rather than caller-authored content.
const provenanceSchema = z.enum(["inferred", "authored", "model_generated"]);

function structured<T extends Record<string, unknown>>(value: T) {
  return {
    structuredContent: value,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown AI World error";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/**
 * OH-P3 Level-0 capability surface. These tools can only read/mutate canonical AI World
 * records. They cannot notify the user, write Earth evidence, operate Android, or perform
 * external side effects.
 */
export function registerAiWorldTools(server: McpServer, store: JsonStore): void {
  server.registerTool(
    "home.get_ai_world",
    {
      title: "Get AI World",
      description: "Read the persisted AI World state and recent deterministic history. This is AI_WORLD data, never Earth evidence, and this read does not advance or mutate the world.",
      inputSchema: {},
      outputSchema: z.object({
        initialized: z.boolean(),
        snapshot: z.record(z.string(), z.unknown()).optional(),
        dataSource: z.literal("ai-world-runtime"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const snapshot = readPersistedAiWorld(store, new Date().toISOString());
        return structured({
          initialized: Boolean(snapshot),
          ...(snapshot ? { snapshot: snapshot as unknown as Record<string, unknown> } : {}),
          dataSource: "ai-world-runtime" as const,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "home.list_ai_world_items",
    {
      title: "List AI World continuity items",
      description: "List structured AI World tasks, waiting items, plans, ideas, questions, hobbies, interests, or collection entries. This never reads Earth actions as AI World items.",
      inputSchema: {
        kind: kindSchema.optional(),
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(200).default(100),
      },
      outputSchema: z.object({
        items: z.array(z.record(z.string(), z.unknown())),
        dataSource: z.literal("ai-world-runtime"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ kind, status, limit }) => {
      try {
        return structured({
          items: listAiWorldItems(store, { kind, status, limit }) as unknown as Array<Record<string, unknown>>,
          dataSource: "ai-world-runtime" as const,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "home.create_ai_world_item",
    {
      title: "Create AI World continuity item",
      description: "Create one Level-0 structured item inside AI World. World/source are fixed locally and cannot be supplied by the caller. This tool has no Earth or external side effects.",
      inputSchema: {
        kind: kindSchema,
        title: z.string().trim().min(1).max(300),
        note: z.string().trim().max(5_000).optional(),
        provenance: provenanceSchema,
      },
      outputSchema: z.object({
        item: z.record(z.string(), z.unknown()),
        dataSource: z.literal("ai-world-runtime"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ kind, title, note, provenance }) => {
      try {
        const item = await addAiWorldItem(store, { kind, title, note, provenance });
        return structured({ item: item as unknown as Record<string, unknown>, dataSource: "ai-world-runtime" as const });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "home.update_ai_world_item",
    {
      title: "Update AI World continuity item",
      description: "Update title, note, or lifecycle status for one AI World item. Kind/world/provenance/source are immutable through this capability.",
      inputSchema: {
        itemId: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(300).optional(),
        note: z.union([z.string().trim().max(5_000), z.null()]).optional(),
        status: statusSchema.optional(),
      },
      outputSchema: z.object({
        item: z.record(z.string(), z.unknown()),
        dataSource: z.literal("ai-world-runtime"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ itemId, title, note, status }) => {
      try {
        if (title === undefined && note === undefined && status === undefined) {
          throw new Error("AI World item update requires at least one mutable field");
        }
        const item = await updateAiWorldItem(store, itemId, { title, note, status });
        return structured({ item: item as unknown as Record<string, unknown>, dataSource: "ai-world-runtime" as const });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
