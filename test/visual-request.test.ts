import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveVisualRequest,
  VISUAL_ACTIVE_USE_FRESHNESS_MS,
  VISUAL_REQUEST_TTL_MS,
} from "../src/visual-request.js";
import type { LifeObservation } from "../src/types.js";

function dwell(
  minutes: number,
  stage: string,
  observedAt: string,
  options: { screenInteractive?: boolean; unlocked?: boolean; lastInteractionAt?: string } = {},
): LifeObservation {
  return {
    id: `dwell-${stage}`,
    kind: "presence_app_dwell",
    world: "EARTH",
    provenance: "observed",
    label: "com.example.game",
    value: `${minutes}m`,
    observedAt,
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata: {
      packageName: "com.example.game",
      startedAt: "2026-09-05T00:00:00.000Z",
      durationMs: String(minutes * 60_000),
      stage,
      screenInteractive: String(options.screenInteractive ?? true),
      unlocked: String(options.unlocked ?? true),
      lastInteractionAt: options.lastInteractionAt ?? observedAt,
    },
  };
}

function declaration(at: string, activity?: string): LifeObservation {
  return {
    id: `declared-${at}`,
    kind: "manual_status",
    world: "EARTH",
    provenance: "user_declared",
    label: "user status",
    value: "我在打游戏",
    observedAt: at,
    source: "user",
    confidence: "declared",
    metadata: activity ? { activity } : undefined,
  };
}

function visual(at: string, activity: string, confidence: number | string = 0.9): LifeObservation {
  const sessionId = `com.example.game:${Date.parse("2026-09-05T00:00:00.000Z")}`;
  return {
    id: `visual-${at}-${activity}`,
    kind: "visual_observation_summary",
    world: "EARTH",
    provenance: "observed",
    label: activity,
    value: `${activity} activity`,
    observedAt: at,
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata: {
      packageName: "com.example.game",
      activity,
      confidence,
      provider: "zhipu",
      model: "glm-4.6v-flash",
      requestId: `request-${at}`,
      sessionId,
    },
  };
}

function captureAudit(id: string, at: string): LifeObservation {
  return {
    id,
    kind: "visual_policy_audit",
    world: "EARTH",
    provenance: "observed",
    label: "capture_succeeded",
    value: "CAPTURED_EPHEMERAL",
    observedAt: at,
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata: {
      packageName: "com.example.other",
      action: "capture_succeeded",
      allowed: "true",
    },
  };
}

test("OH-44: unknown active context can reach Brain at the first 5 minute dwell", () => {
  const item = dwell(5, "1", "2026-09-05T00:05:00.000Z");
  const request = deriveVisualRequest(item, [item]);
  assert.ok(request);
  assert.equal(request.packageName, "com.example.game");
  assert.equal(request.sessionId, `com.example.game:${Date.parse("2026-09-05T00:00:00.000Z")}`);
  assert.equal(request.reason, "unknown_dwell");
  assert.equal(Date.parse(request.expiresAt) - Date.parse(request.issuedAt), VISUAL_REQUEST_TTL_MS);
});

test("OH-43/OH-44: screen off, locked, stale activity, or missing activity evidence fails closed", () => {
  const at = "2026-09-05T00:10:00.000Z";
  assert.equal(deriveVisualRequest(dwell(10, "2", at, { screenInteractive: false }), []), null);
  assert.equal(deriveVisualRequest(dwell(10, "2", at, { unlocked: false }), []), null);

  const staleInteraction = new Date(Date.parse(at) - VISUAL_ACTIVE_USE_FRESHNESS_MS - 1).toISOString();
  assert.equal(deriveVisualRequest(dwell(10, "2", at, { lastInteractionAt: staleInteraction }), []), null);

  const missingEvidence = dwell(10, "2", at);
  delete missingEvidence.metadata?.screenInteractive;
  delete missingEvidence.metadata?.unlocked;
  delete missingEvidence.metadata?.lastInteractionAt;
  assert.equal(deriveVisualRequest(missingEvidence, [missingEvidence]), null);
});

test("unstructured user declaration lowers urgency to partial context", () => {
  const at5 = dwell(5, "1", "2026-09-05T00:05:00.000Z");
  assert.equal(deriveVisualRequest(at5, [declaration("2026-09-05T00:01:00.000Z"), at5]), null);

  const at10 = dwell(10, "2", "2026-09-05T00:10:00.000Z");
  const request = deriveVisualRequest(at10, [declaration("2026-09-05T00:01:00.000Z"), at10]);
  assert.ok(request);
  assert.equal(request.reason, "partial_dwell");
});

test("structured user declaration lowers urgency further but does not disable future glance", () => {
  const declared = declaration("2026-09-05T00:01:00.000Z", "gaming");
  assert.equal(deriveVisualRequest(dwell(10, "2", "2026-09-05T00:10:00.000Z"), [declared]), null);
  const item = dwell(20, "3", "2026-09-05T00:20:00.000Z");
  const request = deriveVisualRequest(item, [declared, item]);
  assert.ok(request);
  assert.equal(request.reason, "known_dwell_recheck");
});

test("recent visual observation enforces cooldown for the same App session", () => {
  const at20 = dwell(20, "3", "2026-09-05T00:20:00.000Z");
  const recentVisual = visual("2026-09-05T00:15:00.000Z", "gaming", "0.9");
  assert.equal(deriveVisualRequest(at20, [recentVisual, at20]), null);

  const at45 = dwell(45, "5", "2026-09-05T00:45:00.000Z");
  const later = deriveVisualRequest(at45, [recentVisual, at45]);
  assert.ok(later);
  assert.equal(later.reason, "known_dwell_recheck");
});

test("conflicting declared and visual activities create a context-conflict curiosity reason after cooldown", () => {
  const item = dwell(30, "4", "2026-09-05T00:30:00.000Z");
  const request = deriveVisualRequest(item, [
    visual("2026-09-05T00:05:00.000Z", "gaming", 0.9),
    declaration("2026-09-05T00:25:00.000Z", "work"),
    item,
  ]);
  assert.ok(request);
  assert.equal(request.reason, "context_conflict");
});

test("old visual understanding becomes stale and can trigger a fresh recheck during active use", () => {
  const item = dwell(120, "8", "2026-09-05T02:00:00.000Z");
  const request = deriveVisualRequest(item, [
    visual("2026-09-05T00:30:00.000Z", "gaming", 0.9),
    item,
  ]);
  assert.ok(request);
  assert.equal(request.reason, "stale_context");
});

test("rolling visual budget blocks a new curiosity request after three successful captures in one hour", () => {
  const item = dwell(5, "1", "2026-09-05T00:05:00.000Z");
  const observations = [
    captureAudit("capture-1", "2026-09-05T00:01:00.000Z"),
    captureAudit("capture-2", "2026-09-05T00:02:00.000Z"),
    captureAudit("capture-3", "2026-09-05T00:03:00.000Z"),
    item,
  ];
  assert.equal(deriveVisualRequest(item, observations), null);
});
