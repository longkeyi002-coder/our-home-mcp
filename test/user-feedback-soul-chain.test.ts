import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import {
  MAX_SINGLE_EVIDENCE_DELTA,
  listAiWorldInterestEvidence,
  listAiWorldPreferenceStates,
  reviewDueAiWorldPreferences,
} from "../src/ai-world-preference.js";
import {
  MAX_SOUL_DELTA,
  applyReviewedPreferenceToSoul,
  listAiWorldSoulChanges,
  listAiWorldSoulTendencies,
} from "../src/ai-world-soul.js";
import { JsonStore } from "../src/store.js";
import { listUserFeedback, recordAndApplyUserFeedback, userFeedbackPolicy } from "../src/user-feedback.js";

const START = "2026-09-05T10:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;
const REVIEW = new Date(Date.parse(START) + 7 * DAY_MS).toISOString();

async function initializedStore() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-feedback-soul-chain-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  return store;
}

test("OH-02/OH-03/OH-13/OH-P4: repeated feedback reaches Soul only through reviewed Preference and existing Soul cap", async () => {
  const store = await initializedStore();

  // Five explicit prefer-more signals create 5 × 0.025 temporary Preference evidence.
  // After seven days of P4.2 decay, magnitude is still 0.09, just above Soul eligibility.
  for (let index = 0; index < 5; index += 1) {
    await recordAndApplyUserFeedback(store, {
      feedbackKey: `manual:reading:${index}`,
      interestKey: "reading",
      signal: "prefer_more",
      occurredAt: START,
      note: `用户第 ${index + 1} 次明确希望继续这类内容`,
    }, START);
  }

  assert.equal(listUserFeedback(store, "reading").length, 5);
  assert.equal(listAiWorldInterestEvidence(store, "reading").length, 5);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.score, 0.125);
  assert.equal(listAiWorldSoulTendencies(store).length, 0);

  const beforeReview = await applyReviewedPreferenceToSoul(store, "reading", START);
  assert.equal(beforeReview.applied, false);
  assert.equal(beforeReview.reason, "preference_not_reviewed");
  assert.equal(listAiWorldSoulTendencies(store).length, 0);

  const reviewed = await reviewDueAiWorldPreferences(store, REVIEW);
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0]?.score, 0.09);

  const soul = await applyReviewedPreferenceToSoul(store, "reading", REVIEW);
  assert.equal(soul.applied, true);
  assert.equal(soul.change?.delta, MAX_SOUL_DELTA);
  assert.equal(soul.tendency?.score, MAX_SOUL_DELTA);
  assert.equal(listAiWorldSoulChanges(store, "reading").length, 1);

  const evidence = listAiWorldInterestEvidence(store, "reading");
  const feedbackIds = new Set(listUserFeedback(store, "reading").map((item) => item.id));
  assert.equal(evidence.every((item) => item.evidenceRefs?.length === 1), true);
  for (const item of evidence) {
    const ref = item.evidenceRefs?.[0];
    assert.ok(ref?.startsWith("earth-user-feedback:"));
    assert.equal(feedbackIds.has(ref!.slice("earth-user-feedback:".length)), true);
  }
});

test("OH-03/OH-P4: all feedback policy effects remain within the existing P4.2 single-evidence cap", () => {
  const signals = [
    "prefer_more",
    "prefer_less",
    "positive_reaction",
    "negative_reaction",
    "correction_support",
    "correction_counter",
  ] as const;

  for (const signal of signals) {
    const policy = userFeedbackPolicy(signal);
    assert.ok(policy.strength * MAX_SINGLE_EVIDENCE_DELTA <= MAX_SINGLE_EVIDENCE_DELTA);
  }
  assert.ok(userFeedbackPolicy("correction_support").strength > userFeedbackPolicy("positive_reaction").strength);
  assert.ok(userFeedbackPolicy("correction_counter").strength > userFeedbackPolicy("negative_reaction").strength);
});
