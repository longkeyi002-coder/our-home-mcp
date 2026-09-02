import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOurHomeServer, type AuthContext } from "../src/server.js";
import { JsonStore } from "../src/store.js";
import { WebhookDecisionEngine, runProactiveCycle } from "../src/worker.js";

async function connectedClient(store: JsonStore, auth: AuthContext = { actor: "agent", subject: "agent-test" }) {
  const server = createOurHomeServer(store, auth);
  const client = new Client({ name: "our-home-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("persists structured records without losing source metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const filePath = join(directory, "our-home.sqlite");
  const store = await JsonStore.open(filePath, false);
  const entry = await store.addDiary({
    title: "测试记录",
    body: "这是一条 Agent Life 记录。",
    author: "agent",
    visibility: "shared",
  });

  const reopened = await JsonStore.open(filePath, false);
  assert.equal(reopened.snapshot().diaries[0]?.body, "这是一条 Agent Life 记录。");
  assert.equal(reopened.snapshot().diaries[0]?.id, entry.id);
  assert.equal(reopened.snapshot().diaries[0]?.source, "AGENT_LIFE");
});

test("exposes focused read and write tools through MCP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), true);
  const { client, server } = await connectedClient(store);

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.ok(names.includes("home.get_today"));
  assert.ok(names.includes("home.write_diary"));
  assert.ok(names.includes("home.list_messages"));
  assert.ok(names.includes("home.propose_relationship_event"));

  const written = await client.callTool({
    name: "home.write_diary",
    arguments: {
      title: "MCP 测试",
      body: "通过 MCP 写入。",
      visibility: "shared",
    },
  });
  assert.equal(written.isError, undefined);
  assert.equal((written.structuredContent as { dataSource: string }).dataSource, "local-mock");

  const diaries = await client.callTool({ name: "home.list_diary", arguments: { limit: 10 } });
  const entries = (diaries.structuredContent as { entries: Array<{ body: string }> }).entries;
  assert.ok(entries.some((entry) => entry.body === "通过 MCP 写入。"));

  const activity = await client.callTool({ name: "home.list_activity", arguments: { limit: 10 } });
  const activities = (activity.structuredContent as { activities: Array<{ kind: string }> }).activities;
  assert.ok(activities.some((item) => item.kind === "diary_written"));

  await client.close();
  await server.close();
});

test("does not expose private diaries unless explicitly requested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  await store.addDiary({ title: "共享", body: "共享内容", author: "agent", visibility: "shared" });
  await store.addDiary({ title: "私密", body: "私密内容", author: "agent", visibility: "private" });
  const { client, server } = await connectedClient(store);

  const shared = await client.callTool({ name: "home.list_diary", arguments: {} });
  const sharedEntries = (shared.structuredContent as { entries: Array<{ visibility: string }> }).entries;
  assert.ok(sharedEntries.every((entry) => entry.visibility === "shared"));

  const privateEntries = await client.callTool({ name: "home.list_diary", arguments: { visibility: "private" } });
  const privateResults = (privateEntries.structuredContent as { entries: Array<{ visibility: string }> }).entries;
  assert.ok(privateResults.length > 0);
  assert.ok(privateResults.every((entry) => entry.visibility === "private"));

  await client.close();
  await server.close();
});

test("major relationship events require both approvals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  const { client, server } = await connectedClient(store, { actor: "user", subject: "user-1" });

  const proposed = await client.callTool({
    name: "home.propose_relationship_event",
    arguments: {
      title: "重要节点",
      occurredAt: "2026-09-01T00:00:00Z",
      importance: "major",
    },
  });
  const event = (proposed.structuredContent as { event: { id: string; approvalStatus: string } }).event;
  assert.equal(event.approvalStatus, "proposed");

  const firstApproval = await client.callTool({
    name: "home.approve_relationship_event",
    arguments: { eventId: event.id, approvedBy: "agent" },
  });
  assert.equal((firstApproval.structuredContent as { event: { approvalStatus: string } }).event.approvalStatus, "proposed");

  const spoofedAgain = await client.callTool({
    name: "home.approve_relationship_event",
    arguments: { eventId: event.id, approvedBy: "agent" },
  });
  assert.equal((spoofedAgain.structuredContent as { event: { approvalStatus: string } }).event.approvalStatus, "proposed");

  const agent = await connectedClient(store, { actor: "agent", subject: "agent-1" });
  const secondApproval = await agent.client.callTool({ name: "home.approve_relationship_event", arguments: { eventId: event.id } });
  assert.equal((secondApproval.structuredContent as { event: { approvalStatus: string } }).event.approvalStatus, "approved");

  await client.close();
  await server.close();
  await agent.client.close();
  await agent.server.close();
});

test("independent SQLite processes do not lose concurrent writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const filePath = join(directory, "our-home.sqlite");
  const store = await JsonStore.open(filePath, false);
  const storeModule = pathToFileURL(join(process.cwd(), "src/store.ts")).href;
  const runWriter = (workerId: string) => new Promise<void>((resolve, reject) => {
    const source = [
      `import { JsonStore } from ${JSON.stringify(storeModule)};`,
      `const store = await JsonStore.open(${JSON.stringify(filePath)}, false);`,
      `for (let index = 0; index < 20; index += 1) await store.addAction({ title: ${JSON.stringify(`进程 ${workerId} 写入`)} + index });`,
    ].join("\n");
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`writer ${workerId} exited with ${code}`)));
  });

  await Promise.all([runWriter("A"), runWriter("B")]);
  assert.equal(store.snapshot().actions.length, 40);
});

test("independent life-loop cycle delivers due candidates without Hermes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  const candidate = await store.scheduleProactiveMessage({
    title: "心跳测试",
    message: "这条消息由独立 Life Loop 投递。",
    reason: "测试到期候选消息",
    dueAt: "2026-09-01T00:00:00Z",
  });
  const delivered: string[] = [];
  const result = await runProactiveCycle(store, {
    deliver: async (item) => delivered.push(item.id),
  }, new Date("2026-09-01T00:01:00Z"));

  assert.equal(result.dueCount, 1);
  assert.equal(result.deliveredCount, 1);
  assert.deepEqual(delivered, [candidate.id]);
  assert.equal(store.snapshot().proactiveQueue[0]?.status, "delivered");
  assert.equal(store.snapshot().heartbeats.length, 1);
});

test("concurrent notification cycles deliver a candidate only once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  await store.scheduleProactiveMessage({
    title: "只投递一次",
    message: "幂等通知测试",
    reason: "并发 cycle",
    dueAt: "2026-09-01T00:00:00Z",
  });
  let deliveries = 0;
  const notifier = {
    deliver: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      deliveries += 1;
    },
  };
  await Promise.all([
    runProactiveCycle(store, notifier, new Date("2026-09-01T00:01:00Z")),
    runProactiveCycle(store, notifier, new Date("2026-09-01T00:01:00Z")),
  ]);
  assert.equal(deliveries, 1);
  assert.equal(store.snapshot().proactiveQueue[0]?.attempts, 1);
});

test("a single authenticated identity cannot perform both approvals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  const user = await connectedClient(store, { actor: "user", subject: "same-person" });
  const proposed = await user.client.callTool({
    name: "home.propose_relationship_event",
    arguments: { title: "审批身份", occurredAt: "2026-09-01T00:00:00Z", importance: "major" },
  });
  const eventId = (proposed.structuredContent as { event: { id: string } }).event.id;
  await user.client.callTool({ name: "home.approve_relationship_event", arguments: { eventId } });
  const second = await user.client.callTool({ name: "home.approve_relationship_event", arguments: { eventId, approvedBy: "agent" } });
  assert.equal((second.structuredContent as { event: { approvalStatus: string } }).event.approvalStatus, "proposed");
  await user.client.close();
  await user.server.close();
});

test("failed proactive delivery remains pending for retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  const candidate = await store.scheduleProactiveMessage({
    title: "失败测试",
    message: "这条消息应当保留待重试。",
    reason: "测试通知失败",
    dueAt: "2026-09-01T00:00:00Z",
  });
  const result = await runProactiveCycle(store, {
    deliver: async () => { throw new Error("channel unavailable"); },
  }, new Date("2026-09-01T00:01:00Z"));
  const saved = store.snapshot().proactiveQueue.find((item) => item.id === candidate.id);

  assert.equal(result.failedCount, 1);
  assert.equal(saved?.status, "pending");
  assert.equal(saved?.attempts, 1);
  assert.equal(saved?.lastError, "channel unavailable");
});

test("decision webhook receives life context and creates a deduplicated candidate", async () => {
  const received: Array<{ type: string; context: { observations: unknown[] } }> = [];
  const httpServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof received[number]);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      candidates: [{
        title: "根据观察生成的候选",
        message: "这是决策适配器生成的候选消息。",
        reason: "测试 phone observation 上下文",
        dueAt: "2026-09-01T00:00:00Z",
        dedupeKey: "decision-test",
      }],
    }));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const directory = await mkdtemp(join(tmpdir(), "our-home-mcp-"));
  const store = await JsonStore.open(join(directory, "our-home.sqlite"), false);
  await store.recordObservation({
    kind: "screen_app",
    label: "当前前台应用",
    value: "示例应用",
    observedAt: "2026-09-01T00:00:00Z",
    source: "phone",
    confidence: "observed",
  });
  const receivedMessages: string[] = [];
  const result = await runProactiveCycle(
    store,
    { deliver: async (candidate) => receivedMessages.push(candidate.message) },
    new Date("2026-09-01T00:01:00Z"),
    new WebhookDecisionEngine(`http://127.0.0.1:${port}/decide`),
  );

  assert.equal(received[0]?.type, "our_home.life_context");
  assert.equal(received[0]?.context.observations.length, 1);
  assert.equal(result.deliveredCount, 1);
  assert.deepEqual(receivedMessages, ["这是决策适配器生成的候选消息。"]);
  assert.equal(store.snapshot().proactiveQueue.length, 1);

  httpServer.close();
});
