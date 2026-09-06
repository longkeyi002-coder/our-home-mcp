import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldExperience, readAiWorldContinuity } from "../src/ai-world-continuity.js";
import { runAiWorldReflectionCycle } from "../src/ai-world-reflection.js";
import { HermesReflectionEngine } from "../src/hermes-reflection.js";
import { JsonStore } from "../src/store.js";

const START = "2026-09-05T10:00:00.000Z";
const output = (decision: unknown) => ({
  id: "resp_reflection",
  output: [{
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: typeof decision === "string" ? decision : JSON.stringify(decision) }],
  }],
});

async function dueStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-hermes-reflection-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  await addAiWorldExperience(store, {
    summary: "只允许反思 AI World 自己的到期经历",
    occurredAt: START,
    provenance: "authored",
    nextReviewAt: START,
  }, START);
  return store;
}

async function fakeHermes(handler: (request: IncomingMessage, response: ServerResponse, body: any) => void) {
  const requests: Array<{ url: string | undefined; headers: IncomingMessage["headers"]; body: any }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: request.url, headers: request.headers, body });
    handler(request, response, body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("OH-20/OH-P4: Hermes reflection receives bounded AI World-only activation and persists public reflection", async (t) => {
  const fake = await fakeHermes((_request, response) => response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(output({
      action: "record_reflection",
      reflection: { title: "复审", summary: "这是可复用的公开反思。" },
    }))));
  t.after(fake.close);
  const store = await dueStore();
  const engine = new HermesReflectionEngine({
    apiUrl: `${fake.url}/v1`,
    apiKey: "reflection-secret",
    conversation: "same-life",
    model: "hermes-agent",
  });

  const result = await runAiWorldReflectionCycle(store, engine, START);
  assert.equal(result.status, "recorded");
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0]?.url, "/v1/responses");
  assert.equal(fake.requests[0]?.headers.authorization, "Bearer reflection-secret");
  assert.equal(fake.requests[0]?.body.conversation, "same-life");
  assert.equal(fake.requests[0]?.body.model, "hermes-agent");
  assert.match(fake.requests[0]?.body.input, /bounded AI World continuity review activation/);
  assert.match(fake.requests[0]?.body.input, /Do not inspect Earth Life/);
  assert.match(fake.requests[0]?.body.input, /"source"/);
  assert.match(fake.requests[0]?.body.input, /"aiWorldState"/);
  assert.match(fake.requests[0]?.body.input, /"soul"/);
  assert.doesNotMatch(fake.requests[0]?.body.input, /"lifeState"|"observations"|"proactiveQueue"/);
  assert.equal(readAiWorldContinuity(store).thoughtThreads.length, 1);
});

for (const decision of [
  { action: "proactive_message", candidate: { title: "x", message: "x", reason: "x" } },
  { action: "record_reflection", reflection: { title: "x", summary: "x" }, reasoning: "hidden" },
  { action: "record_reflection", reflection: { title: "x", summary: "x", soulDelta: 1 } },
]) {
  test("OH-03/OH-P4: Hermes cannot escape reflection contract into messaging, hidden reasoning, or Soul mutation", async (t) => {
    const fake = await fakeHermes((_request, response) => response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(output(decision))));
    t.after(fake.close);
    const store = await dueStore();
    const before = store.snapshot();

    const result = await runAiWorldReflectionCycle(
      store,
      new HermesReflectionEngine({ apiUrl: fake.url, apiKey: "secret" }),
      START,
    );

    assert.equal(result.status, "provider_failed");
    assert.equal(readAiWorldContinuity(store).thoughtThreads.length, 0);
    assert.deepEqual(store.snapshot().proactiveQueue, before.proactiveQueue);
    assert.deepEqual(store.snapshot().observations, before.observations);
    assert.deepEqual(store.snapshot().aiWorld?.continuity?.soulTendencies, before.aiWorld?.continuity?.soulTendencies);
  });
}
