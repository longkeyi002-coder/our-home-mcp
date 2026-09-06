import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { addAiWorldItem, listAiWorldItems } from "../src/ai-world-items.js";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { createOurHomeServer } from "../src/server.js";
import { JsonStore } from "../src/store.js";

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-p3-complete-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  return store;
}

test("OH-11/OH-P3: AI World exposes an explicit virtual location independent of room", async () => {
  const store = await createStore();
  const aiWorld = store.snapshot().aiWorld!;

  assert.equal(aiWorld.state.home, "our_home");
  assert.equal(aiWorld.state.location, "our_home");
  assert.equal(aiWorld.state.room, "study");
  assert.equal(aiWorld.history[0]?.changes.location, "our_home");

  await advancePersistedAiWorld(store, "2026-09-05T18:00:00.000Z", "UTC");
  const later = store.snapshot().aiWorld!;
  assert.equal(later.state.location, "our_home");
  assert.equal(later.state.room, "living_room");
});

test("OH-11/OH-P3: idea and question exist as structured containers without automatic generation", async () => {
  const store = await createStore();
  assert.equal(listAiWorldItems(store, { kind: "idea" }).length, 0);
  assert.equal(listAiWorldItems(store, { kind: "question" }).length, 0);

  const idea = await addAiWorldItem(store, {
    kind: "idea",
    title: "以后可以重新整理书架",
    provenance: "authored",
  }, "2026-09-05T10:01:00.000Z");
  const question = await addAiWorldItem(store, {
    kind: "question",
    title: "窗边适合放什么植物？",
    provenance: "model_generated",
  }, "2026-09-05T10:02:00.000Z");

  assert.equal(idea.kind, "idea");
  assert.equal(question.kind, "question");
  assert.equal(listAiWorldItems(store).length, 2);
});

test("OH-52/OH-P3: bounded MCP can store idea/question but does not create Earth side effects", async () => {
  const store = await createStore();
  const beforeLife = store.getLifeContext("2026-09-05T10:00:00.000Z").lifeState;
  const server = createOurHomeServer(store);
  const client = new Client({ name: "p3-complete-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    for (const kind of ["idea", "question"] as const) {
      const result = await client.callTool({
        name: "home.create_ai_world_item",
        arguments: {
          kind,
          title: `${kind} via MCP`,
          provenance: "model_generated",
        },
      });
      assert.equal(result.isError, undefined);
      const item = (result.structuredContent as { item: { kind: string; world: string } }).item;
      assert.deepEqual([item.kind, item.world], [kind, "AI_WORLD"]);
    }

    const afterLife = store.getLifeContext("2026-09-05T10:05:00.000Z").lifeState;
    assert.deepEqual(afterLife, beforeLife);
    assert.equal(store.snapshot().proactiveQueue.length, 0);
    assert.equal(store.snapshot().observations.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});
