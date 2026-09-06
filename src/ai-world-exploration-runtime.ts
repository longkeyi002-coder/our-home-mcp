import {
  PersistingAiWorldExplorationAdapter,
} from "./ai-world-exploration-memory.js";
import type { AiWorldExplorationAdapter } from "./ai-world-exploration.js";
import { PublicWebSearchHttpAdapter } from "./public-web-search.js";
import type { JsonStore } from "./store.js";

export interface AiWorldExplorationRuntimeConfig {
  enabled: boolean;
  searchUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export function aiWorldExplorationConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AiWorldExplorationRuntimeConfig {
  return {
    enabled: env.OUR_HOME_EXPLORATION_ENABLED === "true",
    searchUrl: env.OUR_HOME_EXPLORATION_SEARCH_URL?.trim() || undefined,
  };
}

/**
 * Constructs the only P5 V0.1 exploration capability used by the Runtime worker.
 * Disabled means no adapter and therefore zero provider calls. Enabled-without-endpoint is a
 * startup configuration error instead of silently pretending autonomous exploration works.
 */
export function selectAiWorldExplorationAdapter(
  store: JsonStore,
  config: AiWorldExplorationRuntimeConfig,
): AiWorldExplorationAdapter | undefined {
  if (!config.enabled) return undefined;
  if (!config.searchUrl) {
    throw new Error("OUR_HOME_EXPLORATION_SEARCH_URL is required when exploration is enabled");
  }

  const provider = new PublicWebSearchHttpAdapter({
    endpoint: config.searchUrl,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.maxResponseBytes === undefined ? {} : { maxResponseBytes: config.maxResponseBytes }),
  });
  return new PersistingAiWorldExplorationAdapter(store, provider);
}
