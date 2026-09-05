import test from "node:test";
import assert from "node:assert/strict";
import { JsonStore } from "../src/store.js";
import { deriveLifeState, deriveLifeStateTransition } from "../src/life-state.js";
import type { LifeObservation, LifeState } from "../src/types.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const asOf = "2026-09-03T12:00:00.000Z";

function observation(input: Partial<LifeObservation> & Pick<LifeObservation, "kind" | "observedAt">): LifeObservation {
  return {
    id: input.id ?? "observation-test",
    kind: input.kind,
    label: input.label ?? input.kind,
    observedAt: input.observedAt,
    source: input.source ?? "phone",
    confidence: input.confidence ?? "observed",
    value: input.value,
    metadata: input.metadata,
    expiresAt: input.expiresAt,
    deviceId: input.deviceId,
  };
}

test("recent foreground app derives active_on_phone", () => {
  const state = deriveLifeState([
    observation({ kind: "device_presence", observedAt: "2026-09-03T11:59:00.000Z", value: "online", metadata: { batteryPercent: 63, charging: false, connectivityState: "online" } }),
    observation({ kind: "screen_app", observedAt: "2026-09-03T11:59:30.000Z", value: "com.example.app" }),
  ], asOf);
  assert.equal(state.currentActivity, "active_on_phone");
  assert.equal(state.foregroundPackage, "com.example.app");
  assert.equal(state.batteryPercent, 63);
  assert.equal(state.charging, false);
  assert.equal(state.connectivityState, "online");
  assert.ok(state.confidence > 0.8);
});

test("periodic usage summary drives life state without a screen_app observation", () => {
  const state = deriveLifeState([
    observation({ kind: "device_presence", observedAt: "2026-09-03T11:59:00.000Z", value: "online", metadata: { batteryPercent: 63, charging: false, connectivityState: "online" } }),
    observation({ kind: "usage_summary", observedAt: "2026-09-03T11:59:30.000Z", metadata: { currentPackage: "com.example.video", currentDurationMs: "120000" } }),
  ], asOf);
  assert.equal(state.currentActivity, "active_on_phone");
  assert.equal(state.foregroundPackage, "com.example.video");
  assert.equal(state.foregroundDwellMs, 120000);
  assert.equal(state.foregroundSessionStartedAt, "2026-09-03T11:57:30.000Z");
  assert.equal(state.batteryPercent, 63);
  assert.equal(state.connectivityState, "online");
});

test("realtime dwell exposes the current App session timing for Care", () => {
  const state = deriveLifeState([
    observation({ kind: "device_presence", observedAt: "2026-09-03T11:59:00.000Z", value: "screen_on", metadata: { connectivityState: "online" } }),
    observation({
      kind: "presence_app_dwell",
      observedAt: asOf,
      label: "com.example.game",
      value: "60m",
      metadata: {
        packageName: "com.example.game",
        startedAt: "2026-09-03T11:00:00.000Z",
        durationMs: "3600000",
        stage: "5",
      },
    }),
  ], asOf);
  assert.equal(state.currentActivity, "active_on_phone");
  assert.equal(state.foregroundPackage, "com.example.game");
  assert.equal(state.foregroundSessionStartedAt, "2026-09-03T11:00:00.000Z");
  assert.equal(state.foregroundDwellMs, 3600000);
});

test("a newer App transition prevents reuse of old dwell timing from an earlier session", () => {
  const state = deriveLifeState([
    observation({
      kind: "presence_app_dwell",
      observedAt: "2026-09-03T11:55:00.000Z",
      label: "com.example.game",
      metadata: { packageName: "com.example.game", startedAt: "2026-09-03T10:55:00.000Z", durationMs: "3600000" },
    }),
    observation({
      kind: "presence_app_transition",
      observedAt: "2026-09-03T11:59:00.000Z",
      value: "com.example.game",
      metadata: { fromPackage: "com.example.other", toPackage: "com.example.game" },
    }),
  ], asOf);
  assert.equal(state.foregroundPackage, "com.example.game");
  assert.equal(state.foregroundSessionStartedAt, "2026-09-03T11:59:00.000Z");
  assert.equal(state.foregroundDwellMs, 60000);
});

test("stale foreground app is not treated as current", () => {
  const state = deriveLifeState([
    observation({ kind: "device_presence", observedAt: "2026-09-03T11:40:00.000Z", value: "screen_off", metadata: { batteryPercent: 40, charging: true, connectivityState: "online" } }),
    observation({ kind: "screen_app", observedAt: "2026-09-03T11:40:00.000Z", value: "com.example.old" }),
  ], asOf);
  assert.notEqual(state.currentActivity, "active_on_phone");
  assert.equal(state.foregroundPackage, null);
  assert.equal(state.foregroundSessionStartedAt, null);
  assert.equal(state.foregroundDwellMs, null);
  assert.equal(state.currentActivity, "unknown");
  assert.equal(state.batteryPercent, null);
  assert.equal(state.charging, null);
  assert.equal(state.connectivityState, "unknown");
  assert.equal(state.lastPhoneActivityAt, "2026-09-03T11:40:00.000Z");
});

test("screen_on does not revive a foreground app observed ten minutes ago", () => {
  const state = deriveLifeState([
    observation({ kind: "screen_app", observedAt: "2026-09-03T11:50:00.000Z", value: "com.example.old" }),
    observation({ kind: "device_presence", observedAt: asOf, value: "screen_on", metadata: { connectivityState: "online" } }),
  ], asOf);

  assert.notEqual(state.currentActivity, "active_on_phone");
  assert.equal(state.foregroundPackage, "com.example.old");
  assert.equal(state.lastPhoneActivityAt, "2026-09-03T11:50:00.000Z");
});

test("no observations derives unknown", () => {
  const state = deriveLifeState([], asOf);
  assert.equal(state.currentActivity, "unknown");
  assert.equal(state.devicePresence, "unknown");
  assert.equal(state.batteryPercent, null);
  assert.equal(state.charging, null);
  assert.deepEqual(state.reasons, ["no current phone observation is available"]);
});

test("charging is retained without inferring sleeping", () => {
  const state = deriveLifeState([observation({ kind: "device_presence", observedAt: "2026-09-03T11:58:00.000Z", value: "screen_off", metadata: { batteryPercent: 82, charging: true, connectivityState: "online" } })], asOf);
  assert.equal(state.currentActivity, "charging");
  assert.equal(state.charging, true);
  assert.ok(!state.reasons.some((reason) => /sleep/i.test(reason)));
});

test("life context exposes the aggregated life state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-life-state-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  await store.recordObservation({ kind: "device_presence", label: "手机在线", value: "online", observedAt: "2026-09-03T11:59:00.000Z", source: "phone", confidence: "observed", metadata: { batteryPercent: 63, charging: false, connectivityState: "online" } });
  await store.recordObservation({ kind: "screen_app", label: "当前前台应用包名", value: "com.example.app", observedAt: "2026-09-03T11:59:30.000Z", source: "phone", confidence: "observed" });
  const context = store.getLifeContext(asOf);
  assert.equal(context.lifeState.currentActivity, "active_on_phone");
  assert.equal(context.lifeState.foregroundPackage, "com.example.app");
});

test("life state transition reports changed state fields", () => {
  const previous: LifeState = {
    lastObservedAt: "2026-09-03T11:59:00.000Z", lastPhoneActivityAt: null, devicePresence: "screen_off", foregroundPackage: null,
    batteryPercent: 63, charging: true, connectivityState: "online", currentActivity: "charging", confidence: 0.8, reasons: ["phone reports charging=true"],
  };
  const current = { ...previous, currentActivity: "active_on_phone" as const, foregroundPackage: "com.example.app", charging: false };
  const transition = deriveLifeStateTransition(previous, current);
  assert.deepEqual(transition?.changedFields, ["foregroundPackage", "charging", "currentActivity"]);
});
