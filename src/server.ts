import type { JsonStore } from "./store.js";
import { registerAiWorldTools } from "./ai-world-mcp.js";
import { createOurHomeServer as createCoreOurHomeServer } from "./server-core.js";

/**
 * Composes the stable Earth/Our Home MCP surface with the bounded P3 AI World surface.
 * AI World tools never receive raw-store access outside their dedicated adapter.
 */
export function createOurHomeServer(store: JsonStore) {
  const server = createCoreOurHomeServer(store);
  registerAiWorldTools(server, store);
  return server;
}
