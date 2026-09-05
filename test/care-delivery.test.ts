import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CARE_MESSAGE_COOLDOWN_MS, decideCareDelivery } from "../src/care-delivery.js";
import { JsonStore } from "../src/store.js";
import type { LifeObservation, LifeState, ProactiveCandidate, WakeEvent, WakeEventType } from "../src/types.js";
import { runProactiveCycle } from "../src/worker.js";

const sessionStartedAt = "2026-09-05T11:00:00.000Z";

function lifeState(overrides: Partial<LifeState> = {}): LifeState {
  return {
    lastObservedAt: "2026-09-05T12:00:00.000Z",
    lastPhoneActivityAt: "2026-09-05T12:00:00.000Z",
    devicePresence: "screen_on",
    foregroundPackage: "com.example.game",
    foregroundSessionStartedAt: sessionStartedAt,
    foregroundDwellMs: 60 * 60_000,
    batteryPercent: 70,
    charging: false,
    connectivityState: "online",
    currentActivity: "active_on_phone",
    confidence: 0.9,
    reasons: ["test"],
    ...overrides,
  };
}

function wake(id: string, type: WakeEventType = "long_dwell", state = lifeState()): WakeEvent {
  return {
    id,
    type,
    status: "handled",
    priority: type === "battery_low" ? "high" : "normal",
    createdAt: "2026-09-05T12:00:00.000Z",
    observedAt: "2026-09-05T12:00:00.000Z",
    reason: "test wake",
    dedupeKey: `${type}:${id}`,
    lifeState: state,
    previousLifeState: state,
  };
}

function candidate(id: string, wakeEventId?: string, overrides: Partial<ProactiveCandidate> = {}): ProactiveCandidate {
  return {
    id,
    title: "休息一下？",
    message: "已经很久啦。",
    reason: "long dwell care",
    dueAt: "2026-09-05T12:00:00.000Z",
    status: "pending",
    createdAt: "2026-09-05T12:00:00.000Z",
    attempts: 0,
    source: "AGENT_LIFE",
    wakeEventId,
    ...overrides,
  };
}

function presence(at: string, dwellMs: number): LifeObservation[] {
  return [
    {
      id: `presence-${at}`,
      kind: "device_presence",
      world: "EARTH",
      provenance: "observed",
      label: "screen on",
      value: "screen_on",
      observedAt: at,
      source: "phone",
      confidence: "observed",
      deviceId: "android-1",
      metadata: { connectivityState: "online" },
    },
    {
      id: `dwell-${at}`,
      kind: "presence_app_dwell",
      world: "EARTH",
      provenance: "observed",
      label: "com.example.game",
      value: `${Math.floor(dwellMs / 60_000)}m`,
      observedAt: at,
      source: "phone",
      confidence: "observed",
      deviceId: "android-1",
      metadata: {
        packageName: "com.example.game",
        startedAt: sessionStartedAt,
        durationMs: String(dwellMs),
        stage: "care-test",
      },
    },
  ];
}

test("non-long-dwell proactive messages are not affected by Care delivery policy", () => {
  const normalWake = wake("battery", "battery_low", lifeState({ foregroundPackage: null, foregroundSessionStartedAt: null, foregroundDwellMs: null }));
  const item = candidate("candidate", normalWake.id);
  assert.deepEqual(
    decideCareDelivery(item, { observations: [], wakeEvents: [normalWake], proactiveQueue: [item] }, "2026-09-05T12:01:00.000Z"),
    { deliver: true, reason: "not_long_dwell" },
  );
});

test("current same-session long dwell can proceed to notifier", () => {
  const careWake = wake("care-1");
  const item = candidate("candidate-1", careWake.id);
  const decision = decideCareDelivery(
    item,
    { observations: presence("2026-09-05T12:00:00.000Z", 60 * 60_000), wakeEvents: [careWake], proactiveQueue: [item] },
    "2026-09-05T12:00:00.000Z",
  );
  assert.deepEqual(decision, { deliver: true, reason: "current_session" });
});

test("leaving the App or locking the screen discards a stale long-dwell candidate", () => {
  const careWake = wake("care-1");
  const item = candidate("candidate-1", careWake.id);
  const observations = [
    ...presence("2026-09-05T12:00:00.000Z", 60 * 60_000),
    {
      id: "screen-off",
      kind: "presence_screen" as const,
      label: "screen_off",
      value: "off",
      observedAt: "2026-09-05T12:05:00.000Z",
      source: "phone" as const,
      confidence: "observed" as const,
      deviceId: "android-1",
      metadata: { interactive: "false", unlocked: "false" },
    },
  ];
  assert.deepEqual(
    decideCareDelivery(item, { observations, wakeEvents: [careWake], proactiveQueue: [item] }, "2026-09-05T12:06:00.000Z"),
    { deliver: false, reason: "stale_long_dwell" },
  );
});

test("recent delivered long-dwell message enforces a separate one-hour Care message cooldown", () => {
  const currentWake = wake("care-current", "long_dwell", lifeState({
    lastObservedAt: "2026-09-05T12:30:00.000Z",
    lastPhoneActivityAt: "2026-09-05T12:30:00.000Z",
    foregroundDwellMs: 90 * 60_000,
  }));
  const previousWake = wake("care-previous");
  const currentCandidate = candidate("candidate-current", currentWake.id, { dueAt: "2026-09-05T12:30:00.000Z" });
  const delivered = candidate("candidate-previous", previousWake.id, {
    status: "delivered",
    deliveredAt: "2026-09-05T12:00:00.000Z",
  });
  const decision = decideCareDelivery(
    currentCandidate,
    {
      observations: presence("2026-09-05T12:30:00.000Z", 90 * 60_000),
      wakeEvents: [currentWake, previousWake],
      proactiveQueue: [currentCandidate, delivered],
    },
    "2026-09-05T12:30:00.000Z",
  );
  assert.equal(decision.deliver, false);
  assert.equal(decision.reason, "care_message_cooldown");
  assert.equal(decision.nextAvailableAt, new Date(Date.parse(delivered.deliveredAt!) + CARE_MESSAGE_COOLDOWN_MS).toISOString());
});

test("Care message cooldown expires after one hour", () => {
  const currentWake = wake("care-current", "long_dwell", lifeState({
    lastObservedAt: "2026-09-05T13:00:00.000Z",
    lastPhoneActivityAt: "2026-09-05T13:00:00.000Z",
    foregroundDwellMs: 120 * 60_000,
  }));
  const previousWake = wake("care-previous");
  const currentCandidate = candidate("candidate-current", currentWake.id, { dueAt: "2026-09-05T13:00:00.000Z" });
  const delivered = candidate("candidate-previous", previousWake.id, {
    status: "delivered",
    deliveredAt: "2026-09-05T12:00:00.000Z",
  });
  assert.deepEqual(
    decideCareDelivery(
      currentCandidate,
      {
        observations: presence("2026-09-05T13:00:00.000Z", 120 * 60_000),
        wakeEvents: [currentWake, previousWake],
        proactiveQueue: [currentCandidate, delivered],
      },
      "2026-09-05T13:00:00.000Z",
    ),
    { deliver: true, reason: "current_session" },
  );
});

test("worker dismisses stale long-dwell message without calling notifier", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-care-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  const careWake = wake("care-worker");
  const item = candidate("candidate-worker", careWake.id);
  await store.update((data) => {
    data.wakeEvents.push(careWake);
    data.proactiveQueue.push(item);
    data.observations.push(
      ...presence("2026-09-05T12:00:00.000Z", 60 * 60_000),
      {
        id: "screen-off-worker",
        kind: "presence_screen",
        label: "screen_off",
        value: "off",
        observedAt: "2026-09-05T12:05:00.000Z",
        source: "phone",
        confidence: "observed",
        deviceId: "android-1",
        metadata: { interactive: "false", unlocked: "false" },
      },
    );
  });

  let calls = 0;
  const result = await runProactiveCycle(store, { deliver: async () => { calls += 1; } }, new Date("2026-09-05T12:06:00.000Z"));
  assert.equal(calls, 0);
  assert.equal(result.deliveredCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(store.snapshot().proactiveQueue.find((entry) => entry.id === item.id)?.status, "dismissed");
});

