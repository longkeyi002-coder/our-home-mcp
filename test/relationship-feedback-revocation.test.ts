import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { listAiWorldInterestEvidence, listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import { listRelationshipFeedbackReview } from "../src/relationship-feedback-review.js";
import {
  applyRelationshipFeedbackRevocation,
  correctRelationshipFeedback,
  recordRelationshipFeedbackRevocation,
  revokeRelationshipFeedback,
} from "../src/relationship-feedback-revocation.js";
import { listAiWorldSoulTendencies } from "../src/ai-world-soul.js";
import { JsonStore } from "../src/store.js";
import { listUserFeedback, recordAndApplyUserFeedback } from "../src/user-feedback.js";

const START = "2026-09-06T13:50:00.000Z";
const LATER = "2026-09-06T13:55:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, START, "UTC");
  return { store, filePath };
}

test("P6.4 revoke preserves original audit, removes revoked evidence from active Preference and never fabricates opposite evidence", async () => {
  const { store } = await initializedStore("our-home-p64-revoke-");
  const original = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:revoke:original",
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
  }, START);

  const revoked = await revokeRelationshipFeedback(store, {
    revocationKey: "p64:revoke:key",
    feedbackId: original.feedback.id,
    occurredAt: LATER,
    note: "remove this learned signal",
  }, LATER);

  assert.equal(revoked.duplicate, false);
  assert.equal(revoked.archivedEvidence.id, original.evidence.id);
  assert.equal(revoked.preference, undefined);
  assert.equal(listUserFeedback(store).length, 1);
  assert.equal(listAiWorldInterestEvidence(store, "reading").length, 0);
  assert.equal(listAiWorldPreferenceStates(store).length, 0);
  assert.equal(listAiWorldSoulTendencies(store).length, 0);

  const review = listRelationshipFeedbackReview(store);
  assert.equal(review.length, 1);
  assert.equal(review[0]?.active, false);
  assert.equal(review[0]?.feedback.id, original.feedback.id);
  assert.equal(review[0]?.evidence?.id, original.evidence.id);
  assert.equal(review[0]?.earthRevocation?.id, revoked.earthRevocation.id);
  assert.equal(review[0]?.aiWorldRevocation?.id, revoked.aiWorldRevocation.id);
});

test("P6.4 revoking one of multiple evidence items rebuilds Preference from active evidence only and invalidates old review basis", async () => {
  const { store } = await initializedStore("our-home-p64-partial-");
  const first = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:partial:1",
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
  }, START);
  const second = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:partial:2",
    interestKey: "reading",
    signal: "positive_reaction",
    occurredAt: START,
  }, START);

  const before = listAiWorldPreferenceStates(store)[0]!;
  await store.update((data) => {
    const preference = data.aiWorld?.continuity?.preferences?.find((item) => item.interestKey === "reading");
    if (!preference) throw new Error("missing preference");
    preference.lastReviewedAt = START;
  });

  const revoked = await revokeRelationshipFeedback(store, {
    revocationKey: "p64:partial:revoke",
    feedbackId: first.feedback.id,
    occurredAt: LATER,
  }, LATER);

  const after = listAiWorldPreferenceStates(store)[0]!;
  assert.equal(before.evidenceCount, 2);
  assert.equal(after.evidenceCount, 1);
  assert.deepEqual(after.evidenceIds, [second.evidence.id]);
  assert.equal(after.lastReviewedAt, undefined);
  assert.ok(after.score > 0);
  assert.equal(listAiWorldInterestEvidence(store, "reading").length, 1);
  assert.equal(revoked.archivedEvidence.id, first.evidence.id);
});

test("P6.4 crash window is recoverable: persisted Earth revocation reconciles once after restart", async () => {
  const { store, filePath } = await initializedStore("our-home-p64-restart-");
  const original = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:restart:feedback",
    interestKey: "architecture",
    signal: "prefer_more",
    occurredAt: START,
  }, START);
  const earth = await recordRelationshipFeedbackRevocation(store, {
    revocationKey: "p64:restart:revocation",
    feedbackId: original.feedback.id,
    occurredAt: LATER,
  }, LATER);

  const reopened = await JsonStore.open(filePath, false);
  const firstApply = await applyRelationshipFeedbackRevocation(reopened, earth.record.id, LATER);
  const replay = await applyRelationshipFeedbackRevocation(reopened, earth.record.id, LATER);

  assert.equal(firstApply.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.aiWorldRevocation.id, firstApply.aiWorldRevocation.id);
  const snapshot = reopened.snapshot() as any;
  assert.equal(snapshot.relationshipFeedbackRevocations.length, 1);
  assert.equal(snapshot.aiWorld.continuity.interestEvidenceRevocations.length, 1);
  assert.equal(snapshot.aiWorld.continuity.revokedInterestEvidence.length, 1);
});

test("P6.4 revocation keys fail closed on conflicting reuse and one feedback cannot be revoked twice", async () => {
  const { store } = await initializedStore("our-home-p64-collision-");
  const first = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:collision:first",
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
  }, START);
  const second = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:collision:second",
    interestKey: "gaming",
    signal: "prefer_less",
    occurredAt: START,
  }, START);

  await recordRelationshipFeedbackRevocation(store, {
    revocationKey: "p64:collision:key",
    feedbackId: first.feedback.id,
    occurredAt: LATER,
  }, LATER);

  await assert.rejects(
    recordRelationshipFeedbackRevocation(store, {
      revocationKey: "p64:collision:key",
      feedbackId: second.feedback.id,
      occurredAt: LATER,
    }, LATER),
    /key collision with different payload/,
  );
  await assert.rejects(
    recordRelationshipFeedbackRevocation(store, {
      revocationKey: "p64:collision:other",
      feedbackId: first.feedback.id,
      occurredAt: LATER,
    }, LATER),
    /already been revoked/,
  );
});

test("P6.4 correction revokes the exact old evidence before creating one new bounded P4.5 feedback/evidence record", async () => {
  const { store } = await initializedStore("our-home-p64-correct-");
  const original = await recordAndApplyUserFeedback(store, {
    feedbackKey: "p64:correct:old",
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
  }, START);

  const corrected = await correctRelationshipFeedback(store, {
    revocationKey: "p64:correct:revoke",
    feedbackId: original.feedback.id,
    occurredAt: LATER,
    correction: {
      feedbackKey: "p64:correct:new",
      interestKey: "reading",
      signal: "correction_counter",
      occurredAt: LATER,
      note: "explicit correction",
    },
  }, LATER);

  assert.equal(corrected.archivedEvidence.id, original.evidence.id);
  assert.notEqual(corrected.replacementFeedback.id, original.feedback.id);
  assert.equal(corrected.replacementEvidence.direction, "counter");
  assert.equal(listUserFeedback(store).length, 2);
  assert.deepEqual(listAiWorldInterestEvidence(store, "reading").map((item) => item.id), [corrected.replacementEvidence.id]);
  const preference = listAiWorldPreferenceStates(store)[0]!;
  assert.equal(preference.evidenceCount, 1);
  assert.deepEqual(preference.evidenceIds, [corrected.replacementEvidence.id]);
  assert.ok(preference.score < 0);
});
