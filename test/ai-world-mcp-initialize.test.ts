import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOurHomeServer } from "../src/server.js";
import { JsonStore } from "../src/store.js";

test("OH-P3: first bounded MCP write initializes AI World without requiring the worker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-mcp-init-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  assert.equal(store.snapshot().aiWorld, undefined);

  const server = createOurHomeServer(store);
  const client = new Client({ name: "ai-world-init-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.callTool({
      name: "home.create_ai_world_item",
      arguments: {
        kind: "idea",
        title: "第一次写入",
        provenance: "authored",
      },
    });
    assert.equal(result.isError, undefined);
    const aiWorld = store.snapshot().aiWorld;
    assert.equal(aiWorld?.state.world, "AI_WORLD");
    assert.equal(aiWorld?.state.location, "our_home");
    assert.equal(aiWorld?.items?.length, 1);
    assert.equal(aiWorld?.items?.[0]?.kind, "idea");
    assert.equal(store.snapshot().observations.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});
