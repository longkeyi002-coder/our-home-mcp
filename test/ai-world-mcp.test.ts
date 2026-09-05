import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { createOurHomeServer } from "../src/server.js";
import { JsonStore } from "../src/store.js";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-mcp-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  const server = createOurHomeServer(store);
  const client = new Client({ name: "ai-world-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { store, server, client };
}

test("OH-P3: MCP reads AI World snapshot without mutating state/history", async () => {
  const { store, server, client } = await setup();
  try {
    const before = store.snapshot().aiWorld;
    const result = await client.callTool({ name: "home.get_ai_world", arguments: {} });
    assert.equal(result.isError, undefined);
    const body = result.structuredContent as { initialized: boolean; snapshot: { state: { world: string }; recentHistory: unknown[] } };
    assert.equal(body.initialized, true);
    assert.equal(body.snapshot.state.world, "AI_WORLD");
    assert.ok(body.snapshot.recentHistory.length >= 1);
    assert.deepEqual(store.snapshot().aiWorld, before);
  } finally {
    await client.close();
    await server.close();
  }
});

test("OH-52/OH-P3: bounded MCP creates and lists all six AI World item kinds", async () => {
  const { store, server, client } = await setup();
  try {
    const kinds = ["task", "waiting", "plan", "hobby", "interest", "collection"] as const;
    for (const kind of kinds) {
      const result = await client.callTool({
        name: "home.create_ai_world_item",
        arguments: { kind, title: `mcp ${kind}`, provenance: "model_generated" },
      });
      assert.equal(result.isError, undefined);
      const item = (result.structuredContent as { item: { world: string; source: string; kind: string } }).item;
      assert.deepEqual([item.world, item.source, item.kind], ["AI_WORLD", "AGENT_LIFE", kind]);
    }
    const listed = await client.callTool({ name: "home.list_ai_world_items", arguments: { limit: 20 } });
    const items = (listed.structuredContent as { items: Array<{ kind: string }> }).items;
    assert.equal(items.length, 6);
    assert.deepEqual(new Set(items.map((item) => item.kind)), new Set(kinds));
    assert.equal(store.snapshot().observations.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("OH-30/OH-32/OH-52: MCP update cannot reclassify AI World boundary or kind", async () => {
  const { store, server, client } = await setup();
  try {
    const createdResult = await client.callTool({
      name: "home.create_ai_world_item",
      arguments: { kind: "plan", title: "原计划", provenance: "authored", world: "EARTH" },
    });
    const created = (createdResult.structuredContent as { item: { id: string; world: string; provenance: string; source: string; kind: string } }).item;
    assert.deepEqual(
      [created.world, created.provenance, created.source, created.kind],
      ["AI_WORLD", "authored", "AGENT_LIFE", "plan"],
    );

    const updatedResult = await client.callTool({
      name: "home.update_ai_world_item",
      arguments: {
        itemId: created.id,
        title: "更新后的计划",
        status: "completed",
        world: "EARTH",
        provenance: "user_declared",
        kind: "task",
      },
    });
    const updated = (updatedResult.structuredContent as { item: { world: string; provenance: string; source: string; kind: string; status: string } }).item;
    assert.deepEqual(
      [updated.world, updated.provenance, updated.source, updated.kind, updated.status],
      ["AI_WORLD", "authored", "AGENT_LIFE", "plan", "completed"],
    );
    assert.equal(store.snapshot().actions.length, 0);
    assert.equal(store.snapshot().relationshipEvents.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("OH-52/OH-P3: AI World MCP mutations leave Earth Life State and delivery controls unchanged", async () => {
  const { store, server, client } = await setup();
  try {
    const beforeLife = store.getLifeContext("2026-09-05T10:00:00.000Z").lifeState;
    const beforeQueue = store.snapshot().proactiveQueue;
    const beforeMessages = store.snapshot().proactiveMessages;

    await client.callTool({
      name: "home.create_ai_world_item",
      arguments: { kind: "interest", title: "夜空", provenance: "authored" },
    });
    const afterLife = store.getLifeContext("2026-09-05T10:05:00.000Z").lifeState;
    assert.deepEqual(afterLife, beforeLife);
    assert.deepEqual(store.snapshot().proactiveQueue, beforeQueue);
    assert.deepEqual(store.snapshot().proactiveMessages, beforeMessages);
  } finally {
    await client.close();
    await server.close();
  }
});

test("OH-P3: empty AI World lifecycle update fails instead of creating write churn", async () => {
  const { server, client } = await setup();
  try {
    const createdResult = await client.callTool({
      name: "home.create_ai_world_item",
      arguments: { kind: "task", title: "测试", provenance: "authored" },
    });
    const created = (createdResult.structuredContent as { item: { id: string } }).item;
    const result = await client.callTool({
      name: "home.update_ai_world_item",
      arguments: { itemId: created.id },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /requires at least one mutable field/);
  } finally {
    await client.close();
    await server.close();
  }
});
