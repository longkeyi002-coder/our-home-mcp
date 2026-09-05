import assert from "node:assert/strict";
import test from "node:test";
import { deriveLifeState } from "../src/life-state.js";
import type { LifeObservation } from "../src/types.js";

function observed(
  id: string,
  kind: LifeObservation["kind"],
  observedAt: string,
  value?: string,
  metadata?: Record<string, string | number | boolean>,
): LifeObservation {
  return {
    id,
    kind,
    world: "EARTH",
    provenance: "observed",
    label: id,
    value,
    observedAt,
    source: "phone",
    confidence: "observed",
    deviceId: "android-presence",
    metadata,
  };

test("realtime app transition becomes the current foreground package", () => {
  const state = deriveLifeState([
    observed("screen-on", "presence_screen", "2026-09-05T00:00:00.000Z", "on", { interactive: "true", unlocked: "true" }),
    observed("game", "presence_app_transition", "2026-09-05T00:00:05.000Z", "com.example.game", { toPackage: "com.example.game" }),
  ], "2026-09-05T00:01:00.000Z");

  assert.equal(state.foregroundPackage, "com.example.game");
  assert.equal(state.devicePresence, "screen_on");
  assert.equal(state.currentActivity, "active_on_phone");
});

test("dwell milestone keeps a long unchanged app session fresh", () => {
  const state = deriveLifeState([
    observed("game", "presence_app_transition", "2026-09-05T00:00:00.000Z", "com.example.game", { toPackage: "com.example.game" }),
    observed("dwell", "presence_app_dwell", "2026-09-05T00:20:00.000Z", "20m", {
      packageName: "com.example.game",
      durationMs: "1200000",
      stage: "2",
    }),
  ], "2026-09-05T00:21:00.000Z");

  assert.equal(state.foregroundPackage, "com.example.game");
  assert.equal(state.currentActivity, "active_on_phone");
  assert.match(state.reasons.join(" "), /realtime foreground presence/);
});

test("screen off ends current foreground knowledge and marks phone probably idle", () => {
  const state = deriveLifeState([
    observed("game", "presence_app_dwell", "2026-09-05T00:20:00.000Z", "20m", { packageName: "com.example.game" }),
    observed("screen-off", "presence_screen", "2026-09-05T00:21:00.000Z", "off", { interactive: "false", unlocked: "false" }),
  ], "2026-09-05T00:22:00.000Z");

  assert.equal(state.foregroundPackage, null);
  assert.equal(state.devicePresence, "screen_off");
  assert.equal(state.currentActivity, "probably_idle");
  assert.equal(state.confidence, 0.9);
});

test("screen on does not resurrect the app that was visible before screen off", () => {
  const state = deriveLifeState([
    observed("game", "presence_app_dwell", "2026-09-05T00:20:00.000Z", "20m", { packageName: "com.example.game" }),
    observed("screen-off", "presence_screen", "2026-09-05T00:21:00.000Z", "off", { interactive: "false", unlocked: "false" }),
    observed("screen-on", "presence_screen", "2026-09-05T00:23:00.000Z", "on", { interactive: "true", unlocked: "true" }),
  ], "2026-09-05T00:24:00.000Z");

  assert.equal(state.devicePresence, "screen_on");
  assert.equal(state.foregroundPackage, null);
  assert.notEqual(state.currentActivity, "active_on_phone");
});

test("new app transition after screen on establishes foreground again", () => {
  const state = deriveLifeState([
    observed("game", "presence_app_transition", "2026-09-05T00:20:00.000Z", "com.example.game", { toPackage: "com.example.game" }),
    observed("screen-off", "presence_screen", "2026-09-05T00:21:00.000Z", "off", { interactive: "false" }),
    observed("screen-on", "presence_screen", "2026-09-05T00:23:00.000Z", "on", { interactive: "true" }),
    observed("chat", "presence_app_transition", "2026-09-05T00:23:05.000Z", "com.example.chat", { toPackage: "com.example.chat" }),
  ], "2026-09-05T00:24:00.000Z");

  assert.equal(state.foregroundPackage, "com.example.chat");
  assert.equal(state.currentActivity, "active_on_phone");
});
