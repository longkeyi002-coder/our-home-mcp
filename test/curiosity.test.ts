import assert from "node:assert/strict";
import test from "node:test";
import { decideCuriosity, VISUAL_COOLDOWN_MS } from "../src/curiosity.js";

const minute = 60_000;
const now = Date.parse("2026-09-05T00:00:00Z");

test("unknown context becomes curious earlier than known context", () => {
  assert.deepEqual(
    decideCuriosity({ understanding: "UNKNOWN", dwellMs: 10 * minute, screenUsable: true, nowMs: now }),
    { requestVisual: true, reason: "unknown_dwell", thresholdMs: 10 * minute },
  );
  const known = decideCuriosity({ understanding: "KNOWN", dwellMs: 10 * minute, screenUsable: true, nowMs: now });
  assert.equal(known.requestVisual, false);
  assert.equal(known.reason, "dwell_too_short");
  assert.equal(known.thresholdMs, 25 * minute);
});

test("user-declared or known context lowers urgency but never disables future recheck", () => {
  const before = decideCuriosity({ understanding: "KNOWN", dwellMs: 24 * minute, screenUsable: true, nowMs: now });
  assert.equal(before.requestVisual, false);
  assert.equal(before.reason, "dwell_too_short");

  const after = decideCuriosity({ understanding: "KNOWN", dwellMs: 25 * minute, screenUsable: true, nowMs: now });
  assert.equal(after.requestVisual, true);
  assert.equal(after.reason, "known_dwell_recheck");
});

test("conflict is eligible sooner but still needs usable screen", () => {
  const conflict = decideCuriosity({ understanding: "CONFLICT", dwellMs: 5 * minute, screenUsable: true, nowMs: now });
  assert.equal(conflict.requestVisual, true);
  assert.equal(conflict.reason, "context_conflict");

  const screenOff = decideCuriosity({ understanding: "CONFLICT", dwellMs: 60 * minute, screenUsable: false, nowMs: now });
  assert.equal(screenOff.requestVisual, false);
  assert.equal(screenOff.reason, "screen_unavailable");
});

test("recent visual observation enforces cooldown", () => {
  const decision = decideCuriosity({
    understanding: "UNKNOWN",
    dwellMs: 60 * minute,
    screenUsable: true,
    nowMs: now,
    lastVisualAtMs: now - VISUAL_COOLDOWN_MS + minute,
  });
  assert.equal(decision.requestVisual, false);
  assert.equal(decision.reason, "visual_cooldown");
  assert.equal(decision.nextReviewAtMs, now + minute);
});

test("cooldown expiry allows a later glance during the same long app session", () => {
  const decision = decideCuriosity({
    understanding: "KNOWN",
    dwellMs: 70 * minute,
    screenUsable: true,
    nowMs: now,
    lastVisualAtMs: now - VISUAL_COOLDOWN_MS,
  });
  assert.equal(decision.requestVisual, true);
  assert.equal(decision.reason, "known_dwell_recheck");
});
