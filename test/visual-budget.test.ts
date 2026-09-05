import test from "node:test";
import assert from "node:assert/strict";
import {
  decideVisualBudget,
  VISUAL_BUDGET_DAILY_LIMIT,
  VISUAL_BUDGET_DAILY_WINDOW_MS,
  VISUAL_BUDGET_HOURLY_LIMIT,
  VISUAL_BUDGET_HOURLY_WINDOW_MS,
} from "../src/visual-budget.js";
import type { LifeObservation } from "../src/types.js";

function capture(
  id: string,
  observedAt: string,
  deviceId = "android-1",
  allowed: boolean | string = true,
  action = "capture_succeeded",
): LifeObservation {
  return {
    id,
    kind: "visual_policy_audit",
    world: "EARTH",
    provenance: "observed",
    label: action,
    value: allowed === true || allowed === "true" ? "CAPTURED_EPHEMERAL" : "BLOCKED",
    observedAt,
    source: "phone",
    confidence: "observed",
    deviceId,
    metadata: {
      packageName: "com.example.game",
      action,
      allowed,
    },
  };
}

test("visual budget starts available with explicit rolling limits", () => {
  const decision = decideVisualBudget([], "android-1", Date.parse("2026-09-05T00:00:00.000Z"));
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "within_budget");
  assert.equal(decision.usedInHour, 0);
  assert.equal(decision.usedInDay, 0);
  assert.equal(VISUAL_BUDGET_HOURLY_LIMIT, 3);
  assert.equal(VISUAL_BUDGET_DAILY_LIMIT, 12);
});

test("three successful captures in a rolling hour exhaust the hourly budget", () => {
  const observations = [
    capture("c1", "2026-09-05T00:10:00.000Z"),
    capture("c2", "2026-09-05T00:20:00.000Z"),
    capture("c3", "2026-09-05T00:30:00.000Z", "android-1", "true"),
  ];
  const now = Date.parse("2026-09-05T00:40:00.000Z");
  const decision = decideVisualBudget(observations, "android-1", now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "hourly_budget_exhausted");
  assert.equal(decision.usedInHour, 3);
  assert.equal(decision.usedInDay, 3);
  assert.equal(decision.nextAvailableAtMs, Date.parse("2026-09-05T01:10:00.000Z"));

  const afterWindow = decideVisualBudget(
    observations,
    "android-1",
    Date.parse("2026-09-05T01:10:00.000Z"),
  );
  assert.equal(afterWindow.allowed, true);
  assert.equal(afterWindow.usedInHour, 2);
  assert.equal(VISUAL_BUDGET_HOURLY_WINDOW_MS, 60 * 60_000);
});

test("twelve successful captures in 24 hours exhaust the daily budget", () => {
  const observations = Array.from({ length: 12 }, (_, index) =>
    capture(
      `c${index + 1}`,
      new Date(Date.parse("2026-09-05T01:00:00.000Z") + index * 2 * 60 * 60_000).toISOString(),
    ));
  const decision = decideVisualBudget(
    observations,
    "android-1",
    Date.parse("2026-09-06T00:00:00.000Z"),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "daily_budget_exhausted");
  assert.equal(decision.usedInDay, 12);
  assert.equal(decision.nextAvailableAtMs, Date.parse("2026-09-06T01:00:00.000Z"));
  assert.equal(VISUAL_BUDGET_DAILY_WINDOW_MS, 24 * 60 * 60_000);
});

test("guard denials, capture failures, future events, and other devices do not consume this device budget", () => {
  const now = Date.parse("2026-09-05T00:40:00.000Z");
  const observations = [
    capture("blocked", "2026-09-05T00:10:00.000Z", "android-1", false, "capture_guard"),
    capture("failed", "2026-09-05T00:20:00.000Z", "android-1", false, "capture_failed"),
    capture("other-device", "2026-09-05T00:30:00.000Z", "android-2"),
    capture("future", "2026-09-05T01:00:00.000Z"),
  ];
  const decision = decideVisualBudget(observations, "android-1", now);
  assert.equal(decision.allowed, true);
  assert.equal(decision.usedInHour, 0);
  assert.equal(decision.usedInDay, 0);
});
