import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import { revokeRelationshipFeedback } from "../src/relationship-feedback-revocation.js";
import { JsonStore } from "../src/store.js";
import { recordAndApplyUserFeedback } from "../src/user-feedback.js";

const START = "2026-09-06T14:00:00.000Z";
const LATER = "2026-09-06T14:05:00.000Z";

async function revokedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  const original = await recordAndApplyUserFeedback(store, {
    feedbackKey: `${prefix}:feedback`,
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
  }, START);
  await revokeRelationshipFeedback(store, {
    revocationKey: `${prefix}:revocation`,
    feedbackId: original.feedback.id,
    occurredAt: LATER,
  }, LATER);
  return store;
}

test("P6.4 generic AI World validation rejects a revocation with a forged world boundary", async () => {
  const store = await revokedStore("our-home-p64-bad-world");
  await store.update((data) => {
    const continuity = data.aiWorld!.continuity as any;
    continuity.interestEvidenceRevocations[0].world = "EARTH";
  });
  assert.throws(() => listAiWorldPreferenceStates(store), /revocation has an invalid world boundary/);
});

test("P6.4 generic AI World validation rejects a revocation targeting missing evidence", async () => {
  const store = await revokedStore("our-home-p64-bad-target");
  await store.update((data) => {
    const continuity = data.aiWorld!.continuity as any;
    continuity.interestEvidenceRevocations[0].evidenceId = "missing-evidence";
    continuity.interestEvidenceRevocations[0].evidenceRefs = ["ai-world-interest-evidence:missing-evidence"];
  });
  assert.throws(() => listAiWorldPreferenceStates(store), /targets missing or unrelated archived evidence/);
});

test("P6.4 generic AI World validation rejects archived evidence without its revocation record", async () => {
  const store = await revokedStore("our-home-p64-orphan-archive");
  await store.update((data) => {
    const continuity = data.aiWorld!.continuity as any;
    continuity.interestEvidenceRevocations = [];
  });
  assert.throws(() => listAiWorldPreferenceStates(store), /archive contains evidence without a revocation record/);
});
