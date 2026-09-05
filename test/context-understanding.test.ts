import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_DECLARATION_FRESH_MS,
  CONTEXT_VISUAL_FRESH_MS,
  deriveContextUnderstanding,
} from "../src/context-understanding.js";
import type { LifeObservation } from "../src/types.js";

const sessionId = `com.example.game:${Date.parse("2026-09-05T00:00:00.000Z")}`;
const now = Date.parse("2026-09-05T01:00:00.000Z");

function declaration(at: string, activity?: string): LifeObservation {
  return {
    id: `decl-${at}-${activity ?? "none"}`,
    kind: "manual_status",
    label: "user status",
    value: activity ?? "busy",
    observedAt: at,
    source: "user",
    confidence: "declared",
    metadata: activity ? { activity } : undefined,
  };
}

function visual(at: string, activity: string, confidence: number | string = 0.9, deviceId = "android-1"): LifeObservation {
  return {
    id: `visual-${at}-${activity}-${deviceId}`,
    kind: "visual_observation_summary",
    label: activity,
    value: `${activity} activity`,
    observedAt: at,
    source: "phone",
    confidence: "observed",
    deviceId,
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

test("no semantic evidence remains UNKNOWN even though Presence knows the App session", () => {
  const result = deriveContextUnderstanding([], "android-1", sessionId, now);
  assert.equal(result.understanding, "UNKNOWN");
  assert.equal(result.lastVisualAtMs, null);
});

test("unstructured fresh declaration is PARTIAL and structured declaration is KNOWN", () => {
  const partial = deriveContextUnderstanding(
    [declaration("2026-09-05T00:30:00.000Z")],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(partial.understanding, "PARTIAL");

  const known = deriveContextUnderstanding(
    [declaration("2026-09-05T00:30:00.000Z", "gaming")],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(known.understanding, "KNOWN");
  assert.equal(known.declaredActivity, "gaming");
});

test("fresh reliable visual summary is KNOWN", () => {
  const item = visual("2026-09-05T00:45:00.000Z", "gaming", "0.85");
  const result = deriveContextUnderstanding([item], "android-1", sessionId, now);
  assert.equal(result.understanding, "KNOWN");
  assert.equal(result.visualActivity, "gaming");
  assert.equal(result.visualConfidence, 0.85);
  assert.equal(result.lastVisualAtMs, Date.parse(item.observedAt));
});

test("fresh user declaration and reliable visual summary produce CONFLICT when activities disagree", () => {
  const result = deriveContextUnderstanding(
    [
      declaration("2026-09-05T00:50:00.000Z", "work"),
      visual("2026-09-05T00:55:00.000Z", "gaming", 0.9),
    ],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(result.understanding, "CONFLICT");
  assert.equal(result.declaredActivity, "work");
  assert.equal(result.visualActivity, "gaming");
});

test("matching declaration and visual summary remain KNOWN", () => {
  const result = deriveContextUnderstanding(
    [
      declaration("2026-09-05T00:50:00.000Z", "gaming"),
      visual("2026-09-05T00:55:00.000Z", "gaming", 0.9),
    ],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(result.understanding, "KNOWN");
});

test("old visual understanding for the same session becomes STALE", () => {
  const asOf = Date.parse("2026-09-05T02:00:01.000Z");
  const item = visual("2026-09-05T01:00:00.000Z", "gaming", 0.9);
  const result = deriveContextUnderstanding([item], "android-1", sessionId, asOf);
  assert.equal(result.understanding, "STALE");
  assert.ok(asOf - (result.lastVisualAtMs ?? 0) > CONTEXT_VISUAL_FRESH_MS);
});

test("low-confidence or unknown fresh visual evidence stays PARTIAL", () => {
  const low = deriveContextUnderstanding(
    [visual("2026-09-05T00:50:00.000Z", "gaming", 0.4)],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(low.understanding, "PARTIAL");

  const unknown = deriveContextUnderstanding(
    [visual("2026-09-05T00:50:00.000Z", "unknown", 0.95)],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(unknown.understanding, "PARTIAL");
});

test("other-device visual evidence and expired declarations do not become current context", () => {
  const expiredAt = new Date(now - CONTEXT_DECLARATION_FRESH_MS - 1).toISOString();
  const result = deriveContextUnderstanding(
    [
      declaration(expiredAt, "gaming"),
      visual("2026-09-05T00:50:00.000Z", "gaming", 0.9, "android-2"),
    ],
    "android-1",
    sessionId,
    now,
  );
  assert.equal(result.understanding, "UNKNOWN");
});
