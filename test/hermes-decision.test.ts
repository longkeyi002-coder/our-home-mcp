import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { HermesDecisionEngine } from "../src/hermes-decision.js";
import { JsonStore } from "../src/store.js";
import { runProactiveCycle } from "../src/worker.js";

const at = (minutes: number) => `2026-09-03T12:${String(minutes).padStart(2, "0")}:00.000Z`;
const output = (decision: unknown) => ({
  id: "resp_test",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: typeof decision === "string" ? decision : JSON.stringify(decision) }] }],
});

async function pendingStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-hermes-"));
  const file = join(dir, "our-home.json");
  const store = await JsonStore.open(file, false);
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(0)));
  await store.recordObservation({ kind: "screen_app", label: "foreground", value: "com.example.app", observedAt: at(1), source: "phone", confidence: "observed" });
  await store.evaluateWakeEvents(at(2));
  return { store, file };
}

async function fakeHermes(handler: (request: IncomingMessage, response: ServerResponse, body: unknown) => void) {
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
  return { requests, url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("no pending event does not call Hermes", async (t) => {
  const fake = await fakeHermes((_request, response) => response.writeHead(500).end());
  t.after(fake.close);
  const dir = await mkdtemp(join(tmpdir(), "our-home-hermes-empty-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(0)), engine);
  assert.equal(fake.requests.length, 0);
});

test("Hermes activation sends one complete wake context with bearer auth and stable conversation", async (t) => {
  const fake = await fakeHermes((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output({ action: "ignore" }))));
  t.after(fake.close);
  const { store } = await pendingStore();
  const event = store.listWakeEvents()[0]!;
  const engine = new HermesDecisionEngine({ apiUrl: `${fake.url}/v1`, apiKey: "only-from-env", conversation: "named-life", model: "hermes-agent" });
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0]!.url, "/v1/responses");
  assert.equal(fake.requests[0]!.headers.authorization, "Bearer only-from-env");
  assert.equal(fake.requests[0]!.body.conversation, "named-life");
  assert.equal(fake.requests[0]!.body.model, "hermes-agent");
  assert.match(fake.requests[0]!.body.input, /Hermes Life Runtime wake activation/);
  for (const value of [event.id, event.type, event.reason, event.observedAt, "wakeEvent", "context", "lifeState", "previousLifeState"]) {
    assert.match(fake.requests[0]!.body.input, new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(store.listWakeEvents("handled").some((item) => item.id === event.id), true);
});

test("proactive Hermes decision uses existing atomic apply and retry cannot duplicate candidate", async (t) => {
  const decision = { action: "proactive_message", candidate: { title: "提醒", message: "休息一下", reason: "wake" } };
  const fake = await fakeHermes((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output(decision))));
  t.after(fake.close);
  const { store } = await pendingStore();
  const event = store.listWakeEvents()[0]!;
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(4)), engine);
  assert.equal(fake.requests.length, 1);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === event.id)?.status, "handled");
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 1);
});

test("failed Hermes activation retries the same wake event exactly once", async (t) => {
  const decision = { action: "proactive_message", candidate: { title: "提醒", message: "休息一下", reason: "wake retry" } };
  let callCount = 0;
  const fake = await fakeHermes((_request, response) => {
    callCount += 1;
    if (callCount === 1) {
      response.writeHead(500).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output(decision)));
  });
  t.after(fake.close);
  const { store } = await pendingStore();
  const event = store.listWakeEvents("pending")[0]!;
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });

  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === event.id)?.status, "pending");
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 0);

  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(4)), engine);
  const candidates = store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === event.id)?.status, "handled");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.wakeEventId, event.id);
  assert.equal(fake.requests.length, 2);

  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(5)), engine);
  assert.equal(fake.requests.length, 2);
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 1);
});

for (const status of [500, 401, 403]) {
  test(`Hermes HTTP ${status} leaves event pending without leaking API key`, async (t) => {
    const secret = `secret-${status}`;
    const fake = await fakeHermes((_request, response) => response.writeHead(status).end("sensitive upstream body"));
    t.after(fake.close);
    const { store } = await pendingStore();
    const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: secret });
    let logged = "";
    const original = process.stderr.write;
    process.stderr.write = ((chunk: any) => { logged += String(chunk); return true; }) as typeof process.stderr.write;
    try { await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine); } finally { process.stderr.write = original; }
    assert.equal(store.listWakeEvents()[0]?.status, "pending");
    assert.doesNotMatch(logged, new RegExp(secret));
    assert.doesNotMatch(logged, /sensitive upstream body/);
  });
}

test("network error and timeout leave events pending", async (t) => {
  const stalled = await fakeHermes(() => {});
  t.after(stalled.close);
  for (const engine of [
    new HermesDecisionEngine({ apiUrl: "http://127.0.0.1:1", apiKey: "secret", timeoutMs: 50 }),
    new HermesDecisionEngine({ apiUrl: stalled.url, apiKey: "secret", timeoutMs: 20 }),
  ]) {
    const { store } = await pendingStore();
    await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
    assert.equal(store.listWakeEvents()[0]?.status, "pending");
  }
});

for (const [name, body] of [
  ["non-JSON output_text", output("not json")],
  ["invalid decision contract", output({ action: "later" })],
  ["missing assistant output_text", { id: "resp_empty", output: [] }],
] as const) {
  test(`Hermes ${name} leaves event pending`, async (t) => {
    const fake = await fakeHermes((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body)));
    t.after(fake.close);
    const { store } = await pendingStore();
    await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" }));
    assert.equal(store.listWakeEvents()[0]?.status, "pending");
    assert.equal(store.snapshot().proactiveQueue.length, 0);
  });
}

test("separate cycles and store restart reuse conversation without persisting secret or session data", async (t) => {
  const fake = await fakeHermes((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output({ action: "ignore" }))));
  t.after(fake.close);
  const { store, file } = await pendingStore();
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "never-persist-me", conversation: "our-home-stable" });
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  await store.recordObservation({ kind: "device_presence", label: "screen off", value: "screen_off", observedAt: at(7), source: "phone", confidence: "observed", metadata: { connectivityState: "online" } });
  await store.evaluateWakeEvents(at(7));
  const reopened = await JsonStore.open(file, false);
  await runProactiveCycle(reopened, { deliver: async () => {} }, new Date(at(8)), engine);
  assert.equal(fake.requests.length, 2);
  assert.deepEqual(fake.requests.map((item) => item.body.conversation), ["our-home-stable", "our-home-stable"]);
  const persisted = await readFile(file, "utf8");
  assert.equal(JSON.parse(persisted).schemaVersion, 2);
  assert.doesNotMatch(persisted, /never-persist-me|our-home-stable|resp_test/);
});
