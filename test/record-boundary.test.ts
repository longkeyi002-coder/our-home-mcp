import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOurHomeServer } from "../src/server.js";
import { JsonStore } from "../src/store.js";
import { isValidRecordBoundary } from "../src/record-boundary.js";
import { isValidWorldProvenance } from "../src/world-boundary.js";

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-record-boundary-"));
  return JsonStore.open(join(directory, "data.json"), false);
}

async function connectedClient(store: JsonStore) {
  const server = createOurHomeServer(store);
  const client = new Client({ name: "record-boundary-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("OH-30/OH-31: non-observation records keep a boundary model separate from evidence rules", () => {
  assert.equal(isValidRecordBoundary("EARTH", "authored"), true);
  assert.equal(isValidWorldProvenance("EARTH", "authored"), false);
  assert.equal(isValidRecordBoundary("EARTH", "simulated"), false);
  assert.equal(isValidRecordBoundary("AI_WORLD", "observed"), false);
  assert.equal(isValidRecordBoundary("FICTION", "user_declared"), false);
});

test("OH-30/OH-31: an AI World diary persists its explicit boundary and its audit activity inherits it", async () => {
  const store = await createStore();
  const entry = await store.addDiary({
    title: "书房笔记",
    body: "整理今天在 AI World 里的想法。",
    author: "agent",
    visibility: "private",
    world: "AI_WORLD",
    provenance: "authored",
  });

  assert.equal(entry.world, "AI_WORLD");
  assert.equal(entry.provenance, "authored");
  const activity = store.snapshot().activities.find((item) => item.kind === "diary_written");
  assert.equal(activity?.world, "AI_WORLD");
  assert.equal(activity?.provenance, "authored");
});

test("OH-32: illegal long-lived record boundaries fail before anything is persisted", async () => {
  const store = await createStore();
  await assert.rejects(
    store.addDiary({
      title: "不能写入",
      body: "simulated data must not silently become Earth",
      author: "agent",
      visibility: "private",
      world: "EARTH",
      provenance: "simulated",
    }),
    /Illegal long-lived record boundary: EARTH\/simulated/,
  );
  await assert.rejects(
    store.addAction({
      title: "不能写入",
      world: "AI_WORLD",
      provenance: "observed",
    }),
    /Illegal long-lived record boundary: AI_WORLD\/observed/,
  );
  assert.equal(store.snapshot().diaries.length, 0);
  assert.equal(store.snapshot().actions.length, 0);
  assert.equal(store.snapshot().activities.length, 0);
});

test("OH-30: legacy internal callers without a boundary fail closed into FICTION/authored", async () => {
  const store = await createStore();
  const diary = await store.addDiary({
    title: "旧内部调用",
    body: "没有显式边界时不能猜成 Earth。",
    author: "agent",
    visibility: "shared",
  });
  const action = await store.addAction({ title: "旧内部行动调用" });

  assert.deepEqual([diary.world, diary.provenance], ["FICTION", "authored"]);
  assert.deepEqual([action.world, action.provenance], ["FICTION", "authored"]);
  assert.equal(store.snapshot().activities.every((item) => item.world === "FICTION"), true);
});

test("OH-30/OH-31/OH-32: MCP requires explicit boundaries and validates illegal pairs", async () => {
  const store = await createStore();
  const { client, server } = await connectedClient(store);
  try {
    const validDiary = await client.callTool({
      name: "home.write_diary",
      arguments: {
        title: "AI World 日记",
        body: "明确属于 AI World。",
        author: "agent",
        visibility: "private",
        world: "AI_WORLD",
        provenance: "authored",
      },
    });
    assert.equal(validDiary.isError, undefined);
    const entry = (validDiary.structuredContent as { entry: { world: string; provenance: string } }).entry;
    assert.deepEqual([entry.world, entry.provenance], ["AI_WORLD", "authored"]);

    const invalidAction = await client.callTool({
      name: "home.create_action",
      arguments: {
        title: "非法 Earth 模拟行动",
        world: "EARTH",
        provenance: "simulated",
      },
    });
    assert.equal(invalidAction.isError, true);
    assert.match(invalidAction.content[0]?.type === "text" ? invalidAction.content[0].text : "", /Illegal long-lived record boundary/);

    const earthAction = await client.callTool({
      name: "home.create_action",
      arguments: {
        title: "现实里的计划",
        world: "EARTH",
        provenance: "authored",
      },
    });
    assert.equal(earthAction.isError, undefined);
    const action = (earthAction.structuredContent as { action: { world: string; provenance: string } }).action;
    assert.deepEqual([action.world, action.provenance], ["EARTH", "authored"]);
  } finally {
    await client.close();
    await server.close();
  }
});
