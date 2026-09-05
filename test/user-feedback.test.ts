import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { listAiWorldInterestEvidence, listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import { listAiWorldSoulTendencies } from "../src/ai-world-soul.js";
import { JsonStore } from "../src/store.js";
import {
  applyUserFeedbackToPreference,
  listUserFeedback,
  recordAndApplyUserFeedback,
  recordUserFeedback,
  userFeedbackPolicy,
} from "../src/user-feedback.js";

const START = "2026-09-05T10:00:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, START, "UTC");
  return { store, filePath };
}

test("OH-02/OH-13/OH-P4: feedback persists as Earth/user_declared and Bridge creates separately referenced AI World evidence", async () => {
  const { store } = await initializedStore("our-home-feedback-boundary-");
  const result = await recordAndApplyUserFeedback(store, {
    feedbackKey: "ui:feedback:1",
    interestKey: "Architecture",
    signal: "prefer_more",
    occurredAt: START,
    note: "我更喜欢你继续研究这个。",
  }, START);

  assert.equal(result.feedback.world, "EARTH");
  assert.equal(result.feedback.provenance, "user_declared");
  assert.equal(result.feedback.source, "RELATIONSHIP");
  assert.equal(result.feedback.interestKey, "architecture");
  assert.equal(result.feedback.derivedEvidenceId, result.evidence.id);

  assert.equal(result.evidence.world, "AI_WORLD");
  assert.equal(result.evidence.provenance, "inferred");
  assert.equal(result.evidence.direction, "support");
  assert.equal(result.evidence.strength, 0.5);
  assert.equal(result.evidence.evidenceKey, `user-feedback:${result.feedback.id}`);
  assert.deepEqual(result.evidence.evidenceRefs, [`earth-user-feedback:${result.feedback.id}`]);
  assert.equal(result.preference.score, 0.025);
});

test("OH-40/OH-P4: duplicate feedback key is idempotent and cannot reinforce Preference twice", async () => {
  const { store } = await initializedStore("our-home-feedback-dedupe-");
  const input = {
    feedbackKey: "message:123:reaction",
    interestKey: "reading",
    signal: "positive_reaction" as const,
    occurredAt: START,
  };
  const first = await recordAndApplyUserFeedback(store, input, START);
  const second = await recordAndApplyUserFeedback(store, input, START);

  assert.equal(first.feedback.id, second.feedback.id);
  assert.equal(second.feedbackDuplicate, true);
  assert.equal(second.duplicate, true);
  assert.equal(listUserFeedback(store).length, 1);
  assert.equal(listAiWorldInterestEvidence(store, "reading").length, 1);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.score, 0.0125);
});

test("OH-31/OH-40: reusing one feedback key for different canonical payload fails closed", async () => {
  const { store } = await initializedStore("our-home-feedback-key-collision-");
  await recordUserFeedback(store, {
    feedbackKey: "stable-key",
    interestKey: "reading",
    signal: "prefer_more",
    occurredAt: START,
  }, START);

  await assert.rejects(
    recordUserFeedback(store, {
      feedbackKey: "stable-key",
      interestKey: "gaming",
      signal: "prefer_less",
      occurredAt: START,
    }, START),
    /key collision with different payload/,
  );
  assert.equal(listUserFeedback(store).length, 1);
});

test("OH-03/OH-P4: feedback strength is deterministic, corrections are stronger, and no signal exceeds P4.2 cap", () => {
  assert.deepEqual(userFeedbackPolicy("positive_reaction"), { direction: "support", strength: 0.25 });
  assert.deepEqual(userFeedbackPolicy("negative_reaction"), { direction: "counter", strength: 0.25 });
  assert.deepEqual(userFeedbackPolicy("prefer_more"), { direction: "support", strength: 0.5 });
  assert.deepEqual(userFeedbackPolicy("prefer_less"), { direction: "counter", strength: 0.5 });
  assert.deepEqual(userFeedbackPolicy("correction_support"), { direction: "support", strength: 1 });
  assert.deepEqual(userFeedbackPolicy("correction_counter"), { direction: "counter", strength: 1 });

  for (const signal of [
    "prefer_more",
    "prefer_less",
    "positive_reaction",
    "negative_reaction",
    "correction_support",
    "correction_counter",
  ] as const) {
    assert.ok(userFeedbackPolicy(signal).strength <= 1);
  }
});

test("OH-03/OH-P4: one user feedback event can affect temporary Preference but cannot directly alter Soul", async () => {
  const { store } = await initializedStore("our-home-feedback-no-soul-");
  const result = await recordAndApplyUserFeedback(store, {
    feedbackKey: "correction:1",
    interestKey: "reading",
    signal: "correction_support",
    occurredAt: START,
  }, START);

  assert.equal(result.preference.score, 0.05);
  assert.equal(listAiWorldSoulTendencies(store).length, 0);
});

test("OH-13/OH-P4: record-only Earth feedback can reconcile its derived evidence later without duplication", async () => {
  const { store, filePath } = await initializedStore("our-home-feedback-reconcile-");
  const recorded = await recordUserFeedback(store, {
    feedbackKey: "crash-window:1",
    interestKey: "architecture",
    signal: "prefer_more",
    occurredAt: START,
  }, START);
  assert.equal(recorded.feedback.derivedEvidenceId, undefined);
  assert.equal(listAiWorldInterestEvidence(store, "architecture").length, 0);

  const applied = await applyUserFeedbackToPreference(store, recorded.feedback.id, START);
  const reopened = await JsonStore.open(filePath, false);
  const replay = await applyUserFeedbackToPreference(reopened, recorded.feedback.id, START);

  assert.equal(replay.duplicate, true);
  assert.equal(replay.evidence.id, applied.evidence.id);
  assert.equal(listAiWorldInterestEvidence(reopened, "architecture").length, 1);
  assert.equal(listUserFeedback(reopened)[0]?.derivedEvidenceId, applied.evidence.id);
});

test("OH-30/OH-32/OH-P4: feedback Bridge cannot mutate Earth Life State, notifications, Android registration or external-control state", async () => {
  const { store } = await initializedStore("our-home-feedback-isolation-");
  const before = store.snapshot();
  const lifeBefore = store.getLifeContext(START).lifeState;

  await recordAndApplyUserFeedback(store, {
    feedbackKey: "isolation:1",
    interestKey: "reading",
    signal: "prefer_less",
    occurredAt: START,
  }, START);

  const after = store.snapshot();
  assert.deepEqual(store.getLifeContext(START).lifeState, lifeBefore);
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.actions, before.actions);
  assert.deepEqual(after.proactiveQueue, before.proactiveQueue);
  assert.deepEqual(after.phoneDeviceRegistrations, before.phoneDeviceRegistrations);
  assert.deepEqual(after.visualRequests, before.visualRequests);
});

test("OH-30/OH-31: corrupt persisted feedback boundary is rejected by feedback reads", async () => {
  const { store } = await initializedStore("our-home-feedback-corrupt-");
  await store.update((data) => {
    (data as any).userFeedback = [{
      id: "bad",
      world: "AI_WORLD",
      provenance: "model_generated",
      source: "AGENT_LIFE",
      feedbackKey: "bad-key",
      interestKey: "reading",
      signal: "prefer_more",
      occurredAt: START,
      createdAt: START,
    }];
  });

  assert.throws(() => listUserFeedback(store), /invalid Earth boundary/);
});
