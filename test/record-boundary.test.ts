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

test("OH-30/OH-31/OH-32: MCP preserves explicit boundaries, rejects illegal pairs, and quarantines legacy calls", async () => {
  const store = await createStore();
  const { client, server } = await connectedClient(store);
  try {
    const legacyDiary = await client.callTool({
      name: "home.write_diary",
      arguments: {
        title: "旧 MCP 调用",
        body: "没有提供边界时必须进入隔离区。",
        author: "agent",
        visibility: "shared",
      },
    });
    assert.equal(legacyDiary.isError, undefined);
    const legacyEntry = (legacyDiary.structuredContent as { entry: { world: string; provenance: string } }).entry;
    assert.deepEqual([legacyEntry.world, legacyEntry.provenance], ["FICTION", "authored"]);

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

test("OH-30/OH-32: MCP world filters keep diary, action and activity reads mechanically isolated", async () => {
  const store = await createStore();
  await store.addDiary({
    title: "现实日记",
    body: "现实世界记录。",
    author: "agent",
    visibility: "shared",
    world: "EARTH",
    provenance: "authored",
  });
  await store.addDiary({
    title: "AI World 日记",
    body: "AI World 记录。",
    author: "agent",
    visibility: "shared",
    world: "AI_WORLD",
    provenance: "authored",
  });
  await store.addAction({
    title: "现实行动",
    world: "EARTH",
    provenance: "authored",
  });
  await store.addAction({
    title: "AI World 行动",
    world: "AI_WORLD",
    provenance: "authored",
  });

  const { client, server } = await connectedClient(store);
  try {
    const earthDiaries = await client.callTool({
      name: "home.list_diary",
      arguments: { world: "EARTH", limit: 20 },
    });
    const earthEntries = (earthDiaries.structuredContent as { entries: Array<{ title: string; world: string }> }).entries;
    assert.equal(earthEntries.length, 1);
    assert.equal(earthEntries[0]?.title, "现实日记");
    assert.equal(earthEntries.every((item) => item.world === "EARTH"), true);

    const aiActions = await client.callTool({
      name: "home.list_actions",
      arguments: { world: "AI_WORLD", limit: 20 },
    });
    const actions = (aiActions.structuredContent as { actions: Array<{ title: string; world: string }> }).actions;
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.title, "AI World 行动");
    assert.equal(actions.every((item) => item.world === "AI_WORLD"), true);

    const aiActivity = await client.callTool({
      name: "home.list_activity",
      arguments: { world: "AI_WORLD", limit: 20 },
    });
    const activities = (aiActivity.structuredContent as { activities: Array<{ world: string }> }).activities;
    assert.equal(activities.length, 2);
    assert.equal(activities.every((item) => item.world === "AI_WORLD"), true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("OH-30/OH-31: relationship approval preserves the event boundary instead of rewriting it as Earth", async () => {
  const store = await createStore();
  const event = await store.proposeRelationshipEvent({
    title: "AI World 共同纪念日",
    occurredAt: "2026-09-05T10:00:00.000Z",
    proposedBy: "agent",
    importance: "major",
    world: "AI_WORLD",
    provenance: "authored",
  });
  assert.deepEqual([event.world, event.provenance], ["AI_WORLD", "authored"]);

  const afterUserApproval = await store.approveRelationshipEvent(event.id, "user");
  assert.equal(afterUserApproval.approvalStatus, "proposed");
  assert.deepEqual([afterUserApproval.world, afterUserApproval.provenance], ["AI_WORLD", "authored"]);

  const approved = await store.approveRelationshipEvent(event.id, "agent");
  assert.equal(approved.approvalStatus, "approved");
  assert.deepEqual([approved.world, approved.provenance], ["AI_WORLD", "authored"]);

  const relationshipActivity = store.snapshot().activities.filter((item) => item.source === "RELATIONSHIP");
  assert.equal(relationshipActivity.length, 3);
  assert.equal(relationshipActivity.every((item) => item.world === "AI_WORLD" && item.provenance === "authored"), true);
});

test("OH-32: relationship events reject illegal boundaries and legacy calls remain quarantined", async () => {
  const store = await createStore();
  await assert.rejects(
    store.proposeRelationshipEvent({
      title: "非法观测",
      occurredAt: "2026-09-05T10:00:00.000Z",
      proposedBy: "agent",
      importance: "ordinary",
      world: "AI_WORLD",
      provenance: "observed",
    }),
    /Illegal long-lived record boundary: AI_WORLD\/observed/,
  );

  const legacy = await store.proposeRelationshipEvent({
    title: "旧关系调用",
    occurredAt: "2026-09-05T10:00:00.000Z",
    proposedBy: "user",
    importance: "ordinary",
  });
  assert.deepEqual([legacy.world, legacy.provenance], ["FICTION", "authored"]);
});

test("OH-30/OH-32: MCP relationship reads are isolated by world and approval keeps the original boundary", async () => {
  const store = await createStore();
  const { client, server } = await connectedClient(store);
  try {
    const earthProposal = await client.callTool({
      name: "home.propose_relationship_event",
      arguments: {
        title: "现实关系节点",
        occurredAt: "2026-09-05T10:00:00.000Z",
        proposedBy: "user",
        importance: "ordinary",
        world: "EARTH",
        provenance: "user_declared",
      },
    });
    assert.equal(earthProposal.isError, undefined);

    const aiProposal = await client.callTool({
      name: "home.propose_relationship_event",
      arguments: {
        title: "AI World 关系节点",
        occurredAt: "2026-09-05T10:05:00.000Z",
        proposedBy: "agent",
        importance: "ordinary",
        world: "AI_WORLD",
        provenance: "authored",
      },
    });
    assert.equal(aiProposal.isError, undefined);
    const aiEvent = (aiProposal.structuredContent as { event: { id: string; world: string; provenance: string } }).event;

    const approval = await client.callTool({
      name: "home.approve_relationship_event",
      arguments: { eventId: aiEvent.id, approvedBy: "user" },
    });
    assert.equal(approval.isError, undefined);
    const approved = (approval.structuredContent as { event: { world: string; provenance: string } }).event;
    assert.deepEqual([approved.world, approved.provenance], ["AI_WORLD", "authored"]);

    const earthList = await client.callTool({
      name: "home.list_relationship_events",
      arguments: { world: "EARTH", limit: 20 },
    });
    const earthEvents = (earthList.structuredContent as { events: Array<{ title: string; world: string }> }).events;
    assert.equal(earthEvents.length, 1);
    assert.equal(earthEvents[0]?.title, "现实关系节点");
    assert.equal(earthEvents.every((item) => item.world === "EARTH"), true);

    const aiList = await client.callTool({
      name: "home.list_relationship_events",
      arguments: { world: "AI_WORLD", limit: 20 },
    });
    const aiEvents = (aiList.structuredContent as { events: Array<{ title: string; world: string }> }).events;
    assert.equal(aiEvents.length, 1);
    assert.equal(aiEvents[0]?.title, "AI World 关系节点");
    assert.equal(aiEvents.every((item) => item.world === "AI_WORLD"), true);
  } finally {
    await client.close();
    await server.close();
  }
});