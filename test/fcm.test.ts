import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FcmNotifier, type FcmSendInput, type FcmSender } from "../src/fcm.js";
import { registerPhone } from "../src/phone-registration.js";
import { JsonStore } from "../src/store.js";
import { NoopNotifier, WebhookNotifier, runProactiveCycle, selectNotifier } from "../src/worker.js";

async function freshStore() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-fcm-"));
  return JsonStore.open(join(directory, "our-home.json"), false);
}

async function due(store: JsonStore) {
  return store.scheduleProactiveMessage({
    title: "该休息一下了",
    message: "起来走动两分钟吧。",
    reason: "持续活跃",
    dueAt: "2026-09-03T00:00:00Z",
    wakeEventId: "wake-1",
  });
}

test("authorized registration persists push address and updates the same device", async () => {
  const store = await freshStore();
  await registerPhone(store, "secret", "Bearer secret", { deviceId: "android-main", appVersion: "0.1", pushFid: "fid-1", pushToken: "token-1" });
  await registerPhone(store, "secret", "Bearer secret", { deviceId: "android-main", appVersion: "0.2", pushFid: "fid-2", pushToken: "token-2" });
  assert.deepEqual(store.snapshot().phoneDeviceRegistrations.map(({ deviceId, appVersion, pushFid, pushToken }) => ({ deviceId, appVersion, pushFid, pushToken })), [
    { deviceId: "android-main", appVersion: "0.2", pushFid: "fid-2", pushToken: "token-2" },
  ]);
});

test("registration returns a device token without bootstrap authorization", async () => {
  const store = await freshStore();
  const result = await registerPhone(store, "secret", "Bearer wrong", { deviceId: "android-main", pushToken: "sensitive" });
  assert.equal(result.deviceId, "android-main");
  assert.equal(store.snapshot().phoneDeviceRegistrations[0]?.pushToken, "sensitive");
});

test("old schema v2 files gain empty device registrations without losing data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-fcm-v2-"));
  const file = join(directory, "data.json");
  await writeFile(file, JSON.stringify({
    schemaVersion: 2, diaries: [{ id: "keep" }], relationshipEvents: [], actions: [], activities: [], proactiveMessages: [],
    homeState: { presence: "unknown", updatedAt: "2026-09-03T00:00:00Z", source: "HOME_STATE" },
    observations: [], routines: [], heartbeats: [], proactiveQueue: [], wakeEvents: [], wakeEngineState: { lastLifeState: null, lastEventAt: {} },
  }));
  const store = await JsonStore.open(file, false);
  assert.equal(store.snapshot().diaries[0]?.id, "keep");
  assert.deepEqual(store.snapshot().phoneDeviceRegistrations, []);
});

test("push addresses are absent from life and Hermes wake context", async () => {
  const store = await freshStore();
  await store.registerPhoneDevice({ deviceId: "android-main", pushFid: "private-fid", pushToken: "private-token" });
  const serialized = JSON.stringify(store.getLifeContext());
  assert.equal(serialized.includes("private-fid"), false);
  assert.equal(serialized.includes("private-token"), false);
});

test("FCM sends one minimal payload and success marks candidate delivered", async () => {
  const store = await freshStore();
  await store.registerPhoneDevice({ deviceId: "android-main", pushToken: "target-token" });
  const candidate = await due(store);
  const sent: FcmSendInput[] = [];
  const result = await runProactiveCycle(store, new FcmNotifier(store, { send: async (input) => { sent.push(input); } }), new Date("2026-09-03T00:01:00Z"));
  assert.equal(result.deliveredCount, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    token: "target-token",
    notification: { title: candidate.title, body: candidate.message },
    data: { candidateId: candidate.id, wakeEventId: "wake-1", reason: candidate.reason, source: "AGENT_LIFE" },
  });
  assert.equal(store.snapshot().proactiveQueue[0]?.status, "delivered");
});

for (const failure of ["FCM send failed with HTTP 401", "FCM send failed with HTTP 403", "FCM send failed with HTTP 500", "network failure"]) {
  test(`${failure} leaves candidate pending`, async () => {
    const store = await freshStore();
    await store.registerPhoneDevice({ deviceId: "android-main", pushToken: "target-token" });
    await due(store);
    const sender: FcmSender = { send: async () => { throw new Error(failure); } };
    await runProactiveCycle(store, new FcmNotifier(store, sender), new Date("2026-09-03T00:01:00Z"));
    assert.equal(store.snapshot().proactiveQueue[0]?.status, "pending");
    assert.equal(store.snapshot().proactiveQueue[0]?.attempts, 1);
  });
}

test("no target stays pending; the next cycle retries the same candidate successfully", async () => {
  const store = await freshStore();
  const candidate = await due(store);
  await runProactiveCycle(store, new FcmNotifier(store, { send: async () => assert.fail("must not send") }), new Date("2026-09-03T00:01:00Z"));
  assert.equal(store.snapshot().proactiveQueue[0]?.status, "pending");
  await store.registerPhoneDevice({ deviceId: "android-main", pushToken: "now-ready" });
  let calls = 0;
  await runProactiveCycle(store, new FcmNotifier(store, { send: async () => { calls += 1; } }), new Date("2026-09-03T00:02:00Z"));
  assert.equal(calls, 1);
  assert.equal(store.snapshot().proactiveQueue.length, 1);
  assert.equal(store.snapshot().proactiveQueue[0]?.id, candidate.id);
  assert.equal(store.snapshot().proactiveQueue[0]?.attempts, 2);
  assert.equal(store.snapshot().proactiveQueue[0]?.status, "delivered");
});

test("primary target is the most recently registered token", async () => {
  const store = await freshStore();
  await store.registerPhoneDevice({ deviceId: "older", pushToken: "old" });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await store.registerPhoneDevice({ deviceId: "newer", pushToken: "new" });
  assert.equal(store.getPrimaryPushDevice()?.deviceId, "newer");
});

test("notifier selection gives FCM precedence, then webhook, then noop", async () => {
  const store = await freshStore();
  assert.ok(selectNotifier(store, { firebaseProjectId: "project", googleCredentials: "/runtime/credentials.json", webhookUrl: "https://unused.example" }) instanceof FcmNotifier);
  assert.ok(selectNotifier(store, { webhookUrl: "https://fallback.example" }) instanceof WebhookNotifier);
  assert.ok(selectNotifier(store, {}) instanceof NoopNotifier);
});
