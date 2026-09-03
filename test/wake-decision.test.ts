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

test("failed proactive Wake Decision is atomic and retryable on the same store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-decision-"));
  let fail = false;
  const fs: StoreFileSystem = { writeFile: async (...args) => { if (fail) { fail = false; throw new Error("disk full"); } return (await import("node:fs/promises")).writeFile(...args); } };
  const store = await JsonStore.open(join(dir, "our-home.json"), false, fs);
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(0)));
  await store.recordObservation({ kind: "screen_app", label: "foreground", value: "com.example.app", observedAt: at(1), source: "phone", confidence: "observed" });
  await store.evaluateWakeEvents(at(2));
  const event = store.listWakeEvents()[0]!;
  fail = true;
  const decision: WakeDecision = { action: "proactive_message", candidate: { title: "一次", message: "一次", reason: "wake" } };
  await assert.rejects(store.applyWakeDecision(event.id, decision), /disk full/);
  assert.equal(store.snapshot().wakeEvents[0]?.status, "pending");
  assert.equal(store.snapshot().proactiveQueue.length, 0);
  await store.applyWakeDecision(event.id, decision);
  const candidates = store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id);
  assert.equal(store.snapshot().wakeEvents[0]?.status, "handled");
  assert.equal(candidates.length, 1);
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

test("worker processes multiple pending Wake Events sequentially within a bounded batch", async () => {
  const store = await pendingStore();
  for (const minute of [7, 11, 17, 21, 27, 31, 37]) {
    const active = [11, 21, 31].includes(minute);
    await store.recordObservation({
      kind: active ? "screen_app" : "device_presence",
      label: active ? "foreground" : "screen off",
      value: active ? "com.example.app" : "screen_off",
      observedAt: at(minute), source: "phone", confidence: "observed",
      metadata: active ? undefined : { connectivityState: "online" },
    });
    await store.evaluateWakeEvents(at(minute));
  }
  let calls = 0;
  const engine: LifeDecisionEngine = { evaluate: async () => { calls++; return { action: "ignore" }; } };
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(38)), engine);
  assert.equal(calls, 5);
  assert.equal(store.listWakeEvents("pending").length, 3);
});

test("restart preserves handled and pending Wake Events, linkage, and schema v2", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-decision-"));
  const filePath = join(dir, "our-home.json");
  const store = await JsonStore.open(filePath, false);
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(0)));
  await store.recordObservation({ kind: "screen_app", label: "foreground", value: "com.example.app", observedAt: at(1), source: "phone", confidence: "observed" });
  await store.evaluateWakeEvents(at(2));
  const first = store.listWakeEvents()[0]!;
  await store.applyWakeDecision(first.id, { action: "proactive_message", candidate: { title: "保留", message: "保留", reason: "test" } });
  await store.recordObservation({ kind: "device_presence", label: "screen off", value: "screen_off", observedAt: at(7), source: "phone", confidence: "observed", metadata: { connectivityState: "online" } });
  await store.evaluateWakeEvents(at(7));
  const reopened = await JsonStore.open(filePath, false);
  const data = reopened.snapshot();
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.wakeEvents.find((item) => item.id === first.id)?.status, "handled");
  assert.ok(data.wakeEvents.some((item) => item.status === "pending"));
  assert.equal(data.proactiveQueue.find((item) => item.wakeEventId === first.id)?.wakeEventId, first.id);
});

test("existing schema v2 records survive reading with new wake defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-decision-"));
  const filePath = join(dir, "our-home.json");
  const legacy = {
    schemaVersion: 2, diaries: [{ id: "legacy-diary" }], relationshipEvents: [], actions: [{ id: "legacy-action" }],
    activities: [], proactiveMessages: [], homeState: { presence: "unknown", updatedAt: at(0), source: "HOME_STATE" },
    observations: [], routines: [], heartbeats: [], proactiveQueue: [],
  };
  await (await import("node:fs/promises")).writeFile(filePath, JSON.stringify(legacy), "utf8");
  const store = await JsonStore.open(filePath, false);
  assert.equal(store.snapshot().schemaVersion, 2);
  assert.equal(store.snapshot().diaries[0]?.id, "legacy-diary");
  assert.equal(store.snapshot().actions[0]?.id, "legacy-action");
  assert.deepEqual(store.snapshot().wakeEvents, []);
});


test("worker persists decision and delivery checkpoints for runtime diagnostics", async () => {
  const store = await pendingStore();
  const wakeEvent = store.listWakeEvents()[0]!;
  const engine: LifeDecisionEngine = { evaluate: async () => ({ action: "ignore" }) };
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  assert.deepEqual(store.snapshot().runtimeDiagnostics.lastWakeDecision, {
    occurredAt: at(3), status: "succeeded", wakeEventId: wakeEvent.id, action: "ignore",
  });

  const candidate = await store.scheduleProactiveMessage({
    title: "delivery", message: "test", reason: "diagnostics", dueAt: at(4),
  });
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(4)));
  assert.deepEqual(store.snapshot().runtimeDiagnostics.lastProactiveDelivery, {
    occurredAt: at(4), status: "succeeded", candidateId: candidate.id,
  });
});
