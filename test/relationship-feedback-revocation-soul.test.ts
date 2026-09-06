import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { listAiWorldPreferenceStates, reviewDueAiWorldPreferences } from "../src/ai-world-preference.js";
import { revokeRelationshipFeedback } from "../src/relationship-feedback-revocation.js";
import {
  applyReviewedPreferenceToSoul,
  listAiWorldSoulChanges,
  listAiWorldSoulTendencies,
} from "../src/ai-world-soul.js";
import { JsonStore } from "../src/store.js";
import { recordAndApplyUserFeedback } from "../src/user-feedback.js";

const START = "2026-09-01T10:00:00.000Z";
const REVIEW = "2026-09-09T10:00:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  return store;
}

test("P6.4 revoking every active Preference evidence item leaves existing Soul tendency and audit unchanged", async () => {
  const store = await initializedStore("our-home-p64-soul-boundary-");
  const feedback = [];
  for (let index = 0; index < 3; index += 1) {
    feedback.push(await recordAndApplyUserFeedback(store, {
      feedbackKey: `p64:soul:${index}`,
      interestKey: "reading",
      signal: "correction_support",
      occurredAt: START,
    }, START));
  }

  await reviewDueAiWorldPreferences(store, REVIEW);
  const soulApplied = await applyReviewedPreferenceToSoul(store, "reading", REVIEW);
  assert.equal(soulApplied.applied, true);

  const soulBefore = listAiWorldSoulTendencies(store);
  const changesBefore = listAiWorldSoulChanges(store, "reading");
  assert.equal(soulBefore.length, 1);
  assert.equal(changesBefore.length, 1);

  for (let index = 0; index < feedback.length; index += 1) {
    const at = new Date(Date.parse(REVIEW) + (index + 1) * 60_000).toISOString();
    await revokeRelationshipFeedback(store, {
      revocationKey: `p64:soul:revoke:${index}`,
      feedbackId: feedback[index]!.feedback.id,
      occurredAt: at,
    }, at);
  }

  assert.equal(listAiWorldPreferenceStates(store).length, 0);
  assert.deepEqual(listAiWorldSoulTendencies(store), soulBefore);
  assert.deepEqual(listAiWorldSoulChanges(store, "reading"), changesBefore);

  const snapshot = store.snapshot() as any;
  assert.equal(snapshot.aiWorld.continuity.interestEvidence.length, 0);
  assert.equal(snapshot.aiWorld.continuity.revokedInterestEvidence.length, 3);
  assert.equal(snapshot.aiWorld.continuity.interestEvidenceRevocations.length, 3);
});
