import test from "node:test";
import assert from "node:assert/strict";
import { deriveVisualRequest, VISUAL_REQUEST_TTL_MS } from "../src/visual-request.js";
import type { LifeObservation } from "../src/types.js";

function dwell(minutes: number, stage: string, observedAt: string): LifeObservation {
  return {
    id: `dwell-${stage}`,
    kind: "presence_app_dwell",
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
    },
  };
}

function declaration(at: string, activity?: string): LifeObservation {
  return {
    id: `declared-${at}`,
    kind: "manual_status",
    label: "user status",
    value: "我在打游戏",
    observedAt: at,
    source: "user",
    confidence: "declared",
    metadata: activity ? { activity } : undefined,
  };
}

test("unknown context creates a short-lived request at first 10 minute dwell", () => {
  const item = dwell(10, "1", "2026-09-05T00:10:00.000Z");
  const request = deriveVisualRequest(item, [item]);
  assert.ok(request);
  assert.equal(request.packageName, "com.example.game");
  assert.equal(request.sessionId, `com.example.game:${Date.parse("2026-09-05T00:00:00.000Z")}`);
  assert.equal(request.reason, "unknown_dwell");
  assert.equal(Date.parse(request.expiresAt) - Date.parse(request.issuedAt), VISUAL_REQUEST_TTL_MS);
});

test("unstructured user declaration lowers urgency to partial context", () => {
  const at10 = dwell(10, "1", "2026-09-05T00:10:00.000Z");
  assert.equal(deriveVisualRequest(at10, [declaration("2026-09-05T00:01:00.000Z"), at10]), null);

  const at20 = dwell(20, "2", "2026-09-05T00:20:00.000Z");
  const request = deriveVisualRequest(at20, [declaration("2026-09-05T00:01:00.000Z"), at20]);
  assert.ok(request);
  assert.equal(request.reason, "partial_dwell");
});

test("structured user declaration lowers urgency further but does not disable future glance", () => {
  const declared = declaration("2026-09-05T00:01:00.000Z", "gaming");
  assert.equal(deriveVisualRequest(dwell(20, "2", "2026-09-05T00:20:00.000Z"), [declared]), null);
  const item = dwell(30, "3", "2026-09-05T00:30:00.000Z");
  const request = deriveVisualRequest(item, [declared, item]);
  assert.ok(request);
  assert.equal(request.reason, "known_dwell_recheck");
});

test("recent visual observation enforces cooldown for the same App session", () => {
  const at20 = dwell(20, "2", "2026-09-05T00:20:00.000Z");
  const sessionId = `com.example.game:${Date.parse("2026-09-05T00:00:00.000Z")}`;
  const visual: LifeObservation = {
    id: "visual-1",
    kind: "visual_observation_summary",
    label: "gaming",
    value: "game activity",
    observedAt: "2026-09-05T00:15:00.000Z",
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata: {
      packageName: "com.example.game",
      activity: "gaming",
      confidence: "0.9",
      provider: "zhipu",
      model: "glm-4.6v-flash",
      requestId: "visual-1",
      sessionId,
    },
  };
  assert.equal(deriveVisualRequest(at20, [visual, at20]), null);

  const at45 = dwell(45, "4", "2026-09-05T00:45:00.000Z");
  const later = deriveVisualRequest(at45, [visual, at45]);
  assert.ok(later);
  assert.equal(later.reason, "known_dwell_recheck");
});
