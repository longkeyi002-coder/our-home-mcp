import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveWakeEventDrafts,
  LONG_DWELL_CARE_COOLDOWN_MS,
  LONG_DWELL_CARE_THRESHOLD_MS,
  WAKE_EVENT_COOLDOWN_MS,
} from "../src/wake-engine.js";
import { JsonStore } from "../src/store.js";
import type { LifeState } from "../src/types.js";
import { runProactiveCycle } from "../src/worker.js";

const state = (overrides: Partial<LifeState> = {}): LifeState => ({
  lastObservedAt: "2026-09-03T12:00:00.000Z",
  lastPhoneActivityAt: "2026-09-03T12:00:00.000Z",
  devicePresence: "online",
  foregroundPackage: null,
  batteryPercent: 63,
  charging: false,
  connectivityState: "online",
  currentActivity: "probably_idle",
  confidence: 0.8,
  reasons: ["test state"],
  ...overrides,
});

const observation = (observedAt: string, value: string, metadata: Record<string, string | number | boolean> = {}) => ({
  kind: "device_presence" as const,
  label: "phone state",
  value,
  observedAt,
  source: "phone" as const,
  confidence: "observed" as const,
  metadata,
});

test("first evaluation establishes baseline without creating a wake event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-wake-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  await store.recordObservation({
    kind: "screen_app",
    label: "foreground",
    value: "com.example.app",
    observedAt: "2026-09-03T12:00:00.000Z",
    source: "phone",
    confidence: "observed",
  });

  assert.deepEqual(await store.evaluateWakeEvents("2026-09-03T12:01:00.000Z"), []);
  assert.equal(store.snapshot().wakeEngineState.lastLifeState?.currentActivity, "active_on_phone");
  assert.deepEqual(store.snapshot().wakeEvents, []);
});

test("non-active to active creates one became_active event", () => {
  const drafts = deriveWakeEventDrafts(
    state({ currentActivity: "probably_idle" }),
    state({ currentActivity: "active_on_phone", foregroundPackage: "com.example.app" }),
    "2026-09-03T12:01:00.000Z",
  );
  assert.equal(drafts[0]?.type, "became_active");
});

test("active to idle, offline, charging, and low battery transitions are classified", () => {
  const active = state({ currentActivity: "active_on_phone", foregroundPackage: "com.example.app" });
  assert.equal(deriveWakeEventDrafts(active, state({ currentActivity: "probably_idle" }), "2026-09-03T12:01:00.000Z")[0]?.type, "became_idle");
  assert.equal(deriveWakeEventDrafts(active, state({ currentActivity: "offline", connectivityState: "offline" }), "2026-09-03T12:01:00.000Z")[0]?.type, "device_offline");
  assert.equal(deriveWakeEventDrafts(state(), state({ charging: true }), "2026-09-03T12:01:00.000Z")[0]?.type, "charging_started");
  assert.equal(deriveWakeEventDrafts(state(), state({ batteryPercent: 20 }), "2026-09-03T12:01:00.000Z")[0]?.type, "battery_low");
});

test("same state and low-confidence or unknown states do not create wake events", () => {
  const current = state({ currentActivity: "active_on_phone" });
  assert.deepEqual(deriveWakeEventDrafts(current, current, "2026-09-03T12:01:00.000Z"), []);
  assert.deepEqual(deriveWakeEventDrafts(
    state({ currentActivity: "probably_idle" }),
    state({ currentActivity: "active_on_phone", confidence: 0.35 }),
    "2026-09-03T12:01:00.000Z",
  ), []);
  assert.deepEqual(deriveWakeEventDrafts(
    state({ currentActivity: "probably_idle" }),
    state({ currentActivity: "unknown", confidence: 0 }),
    "2026-09-03T12:01:00.000Z",
  ), []);
});

test("cooldown suppresses a repeated transition type", () => {
  const previous = state({ currentActivity: "probably_idle" });
  const current = state({ currentActivity: "active_on_phone" });
  const firstAt = "2026-09-03T12:01:00.000Z";
  assert.equal(deriveWakeEventDrafts(previous, current, firstAt)[0]?.type, "became_active");
  assert.deepEqual(deriveWakeEventDrafts(previous, current, "2026-09-03T12:02:00.000Z", { became_active: firstAt }), []);
  const afterCooldown = new Date(Date.parse(firstAt) + WAKE_EVENT_COOLDOWN_MS).toISOString();
  assert.equal(deriveWakeEventDrafts(previous, current, afterCooldown, { became_active: firstAt })[0]?.type, "became_active");
});

test("60 minute dwell creates a Care wake even without an App transition", () => {
  const longDwell = state({
    currentActivity: "active_on_phone",
    foregroundPackage: "com.example.game",
    foregroundSessionStartedAt: "2026-09-03T11:00:00.000Z",
    foregroundDwellMs: LONG_DWELL_CARE_THRESHOLD_MS,
    confidence: 0.9,
  });
  const drafts = deriveWakeEventDrafts(longDwell, longDwell, "2026-09-03T12:00:00.000Z");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.type, "long_dwell");
  assert.equal(drafts[0]?.priority, "normal");
  assert.equal(drafts[0]?.dedupeKey, "long_dwell:com.example.game:2026-09-03T11:00:00.000Z");
});

test("long dwell Care requires a current session and at least 60 minutes", () => {
  const short = state({
    currentActivity: "active_on_phone",
    foregroundPackage: "com.example.game",
    foregroundSessionStartedAt: "2026-09-03T11:01:00.000Z",
    foregroundDwellMs: LONG_DWELL_CARE_THRESHOLD_MS - 60_000,
    confidence: 0.9,
  });
  assert.deepEqual(deriveWakeEventDrafts(short, short, "2026-09-03T12:00:00.000Z"), []);

  const unknownSession = state({
    currentActivity: "active_on_phone",
    foregroundPackage: "com.example.game",
    foregroundDwellMs: LONG_DWELL_CARE_THRESHOLD_MS,
    confidence: 0.9,
  });
  assert.deepEqual(deriveWakeEventDrafts(unknownSession, unknownSession, "2026-09-03T12:00:00.000Z"), []);
});

test("long dwell Care has a one hour wake cooldown and stable session dedupe key", () => {
  const firstAt = "2026-09-03T12:00:00.000Z";
  const make = (dwellMs: number) => state({
    currentActivity: "active_on_phone",
    foregroundPackage: "com.example.game",
    foregroundSessionStartedAt: "2026-09-03T11:00:00.000Z",
    foregroundDwellMs: dwellMs,
    confidence: 0.9,
  });

  const first = deriveWakeEventDrafts(make(LONG_DWELL_CARE_THRESHOLD_MS), make(LONG_DWELL_CARE_THRESHOLD_MS), firstAt);
  assert.equal(first[0]?.type, "long_dwell");

  const thirtyMinutesLater = new Date(Date.parse(firstAt) + 30 * 60_000).toISOString();
  assert.deepEqual(
    deriveWakeEventDrafts(make(90 * 60_000), make(90 * 60_000), thirtyMinutesLater, { long_dwell: firstAt }),
    [],
  );

  const oneHourLater = new Date(Date.parse(firstAt) + LONG_DWELL_CARE_COOLDOWN_MS).toISOString();
  const later = deriveWakeEventDrafts(make(120 * 60_000), make(120 * 60_000), oneHourLater, { long_dwell: firstAt });
  assert.equal(later[0]?.type, "long_dwell");
  assert.equal(later[0]?.dedupeKey, first[0]?.dedupeKey);
});

test("store persists wake events and migrates schema v2 files without wake fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-wake-"));
  const filePath = join(directory, "our-home.json");
  await writeFile(filePath, JSON.stringify({
    schemaVersion: 2,
    diaries: [],
    relationshipEvents: [],
    actions: [],
    activities: [],
    proactiveMessages: [],
    homeState: { presence: "unknown", updatedAt: "2026-09-03T12:00:00.000Z", source: "HOME_STATE" },
    observations: [observation("2026-09-03T12:00:00.000Z", "online", { connectivityState: "online" })],
    routines: [],
    heartbeats: [],
    proactiveQueue: [],
  }), "utf8");
  const store = await JsonStore.open(filePath, false);
  assert.deepEqual(store.snapshot().wakeEvents, []);
  assert.equal(store.snapshot().wakeEngineState.lastLifeState, null);

  await store.evaluateWakeEvents("2026-09-03T12:01:00.000Z");
  await store.recordObservation({
    kind: "device_presence",
    label: "phone offline",
    value: "offline",
    observedAt: "2026-09-03T12:02:00.000Z",
    source: "phone",
    confidence: "observed",
    metadata: { connectivityState: "offline" },
  });
  await store.evaluateWakeEvents("2026-09-03T12:02:00.000Z");
  const reopened = await JsonStore.open(filePath, false);
  assert.equal(reopened.snapshot().wakeEvents[0]?.type, "device_offline");
  assert.equal(reopened.getLifeContext("2026-09-03T12:02:00.000Z").pendingWakeEvents.length, 1);
});

test("worker evaluates wake events before the decision flow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-wake-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  const baselineAt = "2026-09-03T12:00:00.000Z";
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(baselineAt));
  await store.recordObservation({
    kind: "screen_app",
    label: "foreground",
    value: "com.example.app",
    observedAt: "2026-09-03T12:01:00.000Z",
    source: "phone",
    confidence: "observed",
  });

  const result = await runProactiveCycle(store, { deliver: async () => {} }, new Date("2026-09-03T12:02:00.000Z"));
  assert.equal(result.wakeEventCount, 1);
  assert.equal(store.getLifeContext("2026-09-03T12:02:00.000Z").pendingWakeEvents[0]?.type, "became_active");
});
