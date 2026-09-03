import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore, type StoreFileSystem } from "../src/store.js";
import { runProactiveCycle, type LifeDecisionEngine } from "../src/worker.js";
import type { WakeDecision, WakeEvent } from "../src/types.js";

const at = (minutes: number) => `2026-09-03T12:${String(minutes).padStart(2, "0")}:00.000Z`;
async function pendingStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-decision-"));
  const store = await JsonStore.open(join(dir, "our-home.json"), false);
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(0)));
  await store.recordObservation({ kind: "screen_app", label: "foreground", value: "com.example.app", observedAt: at(1), source: "phone", confidence: "observed" });
  await store.evaluateWakeEvents(at(2));
  return store;
}

test("ignore handles exactly one event", async () => {
  const store = await pendingStore();
  const event = store.listWakeEvents()[0]!;
  await store.applyWakeDecision(event.id, { action: "ignore" });
  assert.equal(store.snapshot().wakeEvents[0]?.status, "handled");
});

test("proactive decision atomically links candidate and handles event", async () => {
  const store = await pendingStore();
  const event = store.listWakeEvents()[0]!;
  await store.applyWakeDecision(event.id, { action: "proactive_message", candidate: { title: "提醒", message: "你好", reason: "wake" } });
  const data = store.snapshot();
  assert.equal(data.wakeEvents[0]?.status, "handled");
  assert.equal(data.proactiveQueue[0]?.wakeEventId, event.id);
});

test("failed or invalid decisions leave events pending", async () => {
  const store = await pendingStore();
  const event = store.listWakeEvents()[0]!;
  const engine: LifeDecisionEngine = { evaluate: async () => { throw new Error("boom"); } };
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  assert.equal(store.snapshot().wakeEvents[0]?.status, "pending");
  const invalid: LifeDecisionEngine = { evaluate: async () => ({ action: "bad" } as unknown as WakeDecision) };
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(4)), invalid);
  assert.equal(store.snapshot().wakeEvents[0]?.status, "pending");
});

test("persist failure is atomic and the same store recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-decision-"));
  let fail = false;
  const fs: StoreFileSystem = { writeFile: async (...args) => { if (fail) { fail = false; throw new Error("disk full"); } return (await import("node:fs/promises")).writeFile(...args); } };
  const store = await JsonStore.open(join(dir, "our-home.json"), false, fs);
  fail = true;
  await assert.rejects(store.addMessage("not committed"), /disk full/);
  assert.equal(store.snapshot().proactiveMessages.length, 0);
  await store.addMessage("recovered");
  assert.equal(store.snapshot().proactiveMessages.length, 1);
});

test("concurrent mutations are serialized without lost updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-decision-"));
  const store = await JsonStore.open(join(dir, "our-home.json"), false);
  await Promise.all([
    store.addMessage("one"),
    store.addMessage("two"),
  ]);
  assert.equal(store.snapshot().proactiveMessages.length, 2);
  assert.equal(JSON.parse(await readFile(join(dir, "our-home.json"), "utf8")).proactiveMessages.length, 2);
});

test("retrying a handled event is idempotent and handled events are not re-decided", async () => {
  const store = await pendingStore();
  const event = store.listWakeEvents()[0]!;
  const decision: WakeDecision = { action: "proactive_message", candidate: { title: "一次", message: "一次", reason: "test" } };
  await store.applyWakeDecision(event.id, decision);
  await store.applyWakeDecision(event.id, decision);
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 1);
  let calls = 0;
  const engine: LifeDecisionEngine = { evaluate: async (input: { wakeEvent: WakeEvent }) => { calls++; return { action: "ignore" }; } };
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(5)), engine);
  assert.equal(calls, 0);
});
