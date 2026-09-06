import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import {
  MAX_RELATIONSHIP_FEEDBACK_REVIEW_ITEMS,
  listRelationshipFeedbackReview,
} from "../src/relationship-feedback-review.js";
import { JsonStore } from "../src/store.js";
import { recordAndApplyUserFeedback } from "../src/user-feedback.js";

const START = "2026-09-06T13:45:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  return store;
}

test("P6.4 review joins exact Earth feedback with its derived AI World evidence", async () => {
  const store = await initializedStore("our-home-p64-review-");
  const applied = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:review:1",
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
    note: "keep this preference evidence auditable",
  }, START);

  const review = listRelationshipFeedbackReview(store);
  assert.equal(review.length, 1);
  assert.equal(review[0]?.feedback.id, applied.feedback.id);
  assert.equal(review[0]?.evidence?.id, applied.evidence.id);
  assert.equal(review[0]?.active, true);
  assert.equal(review[0]?.earthRevocation, undefined);
  assert.equal(review[0]?.aiWorldRevocation, undefined);
});

test("P6.4 review is explicitly bounded and rejects unsafe limits", async () => {
  const store = await initializedStore("our-home-p64-review-bounds-");
  assert.deepEqual(listRelationshipFeedbackReview(store, 1), []);
  assert.throws(() => listRelationshipFeedbackReview(store, 0), /review limit must be between/);
  assert.throws(
    () => listRelationshipFeedbackReview(store, MAX_RELATIONSHIP_FEEDBACK_REVIEW_ITEMS + 1),
    /review limit must be between/,
  );
});
