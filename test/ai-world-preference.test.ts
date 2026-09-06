import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld, readPersistedAiWorld } from "../src/ai-world-store.js";
import {
  MAX_SINGLE_EVIDENCE_DELTA,
  PREFERENCE_DAILY_DECAY,
  addAiWorldInterestEvidence,
  derivePreferenceScore,
  listAiWorldInterestEvidence,
  listAiWorldPreferenceStates,
  reviewDueAiWorldPreferences,
} from "../src/ai-world-preference.js";
import { JsonStore } from "../src/store.js";

const START = "2026-09-05T10:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, START, "UTC");
  return { store, filePath };
}

function plusDays(days: number): string {
  return new Date(Date.parse(START) + days * DAY_MS).toISOString();
}

test("OH-P4: one interest evidence item has a hard bounded preference effect", async () => {
  const { store } = await initializedStore("our-home-pref-bound-");
  const applied = await addAiWorldInterestEvidence(store, {
    interestKey: "Urban Photography",
    evidenceKey: "experience:photo-walk-1",
    direction: "support",
    strength: 1,
    reason: "主动完成了一次虚拟城市摄影整理。",
    provenance: "authored",
    occurredAt: START,
  }, START);

  assert.equal(applied.duplicate, false);
  assert.equal(applied.evidence.world, "AI_WORLD");
  assert.equal(applied.preference.world, "AI_WORLD");
  assert.equal(applied.preference.provenance, "inferred");
  assert.equal(applied.preference.score, MAX_SINGLE_EVIDENCE_DELTA);
  assert.ok(Math.abs(applied.preference.score) <= MAX_SINGLE_EVIDENCE_DELTA);
});

test("OH-P4: duplicate evidence cannot reinforce the same preference twice", async () => {
  const { store } = await initializedStore("our-home-pref-dedupe-");
  const input = {
    interestKey: "Reading",
    evidenceKey: "journal:reading-session-1",
    direction: "support" as const,
    strength: 0.8,
    reason: "完成了一次持续阅读。",
    provenance: "authored" as const,
    occurredAt: START,
  };

  const first = await addAiWorldInterestEvidence(store, input, START);
  const duplicate = await addAiWorldInterestEvidence(store, {
    ...input,
    direction: "counter",
    strength: 1,
    reason: "这条冲突内容必须因相同 evidenceKey 被忽略。",
  }, plusDays(1));

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.evidence.id, first.evidence.id);
  assert.equal(listAiWorldInterestEvidence(store, "READING").length, 1);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.evidenceCount, 1);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.score, first.preference.score);
});

test("OH-P4: preference reduction is deterministic regardless of evidence write order", async () => {
  const left = await initializedStore("our-home-pref-order-left-");
  const right = await initializedStore("our-home-pref-order-right-");
  const asOf = plusDays(2);
  const early = {
    interestKey: "Music",
    evidenceKey: "experience:music-early",
    direction: "support" as const,
    strength: 0.9,
    reason: "早期正向经历。",
    provenance: "authored" as const,
    occurredAt: START,
  };
  const later = {
    interestKey: "Music",
    evidenceKey: "experience:music-later",
    direction: "counter" as const,
    strength: 0.4,
    reason: "稍后的反向经历。",
    provenance: "authored" as const,
    occurredAt: plusDays(1),
  };

  await addAiWorldInterestEvidence(left.store, early, asOf);
  await addAiWorldInterestEvidence(left.store, later, asOf);
  await addAiWorldInterestEvidence(right.store, later, asOf);
  await addAiWorldInterestEvidence(right.store, early, asOf);

  const leftPreference = listAiWorldPreferenceStates(left.store)[0]!;
  const rightPreference = listAiWorldPreferenceStates(right.store)[0]!;
  assert.equal(leftPreference.score, rightPreference.score);
  assert.equal(leftPreference.evidenceCount, 2);
  assert.equal(rightPreference.evidenceCount, 2);
  assert.equal(leftPreference.lastEvidenceAt, plusDays(1));
  assert.equal(rightPreference.lastEvidenceAt, plusDays(1));

  const directLeft = derivePreferenceScore(listAiWorldInterestEvidence(left.store, "music"), asOf);
  const directRight = derivePreferenceScore(listAiWorldInterestEvidence(right.store, "music"), asOf);
  assert.equal(directLeft, directRight);
});

test("OH-65/OH-P4: due preference review applies deterministic time decay toward neutral with no new evidence", async () => {
  const { store } = await initializedStore("our-home-pref-decay-");
  await addAiWorldInterestEvidence(store, {
    interestKey: "Gardening",
    evidenceKey: "experience:garden-1",
    direction: "support",
    strength: 1,
    reason: "一次明确但有限的兴趣证据。",
    provenance: "authored",
    occurredAt: START,
  }, START);

  const reviewed = await reviewDueAiWorldPreferences(store, plusDays(7));
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0]?.score, MAX_SINGLE_EVIDENCE_DELTA - 7 * PREFERENCE_DAILY_DECAY);
  assert.equal(reviewed[0]?.evidenceCount, 1);
  assert.equal(listAiWorldInterestEvidence(store, "gardening").length, 1);

  const neutralized = await reviewDueAiWorldPreferences(store, plusDays(14));
  assert.equal(neutralized.length, 1);
  assert.equal(neutralized[0]?.score, 0);
  assert.equal(neutralized[0]?.nextReviewAt, undefined);
});

test("OH-P4: preference evidence and state survive restart and deterministic AI World progression", async () => {
  const { store, filePath } = await initializedStore("our-home-pref-restart-");
  const applied = await addAiWorldInterestEvidence(store, {
    interestKey: "Architecture",
    evidenceKey: "experience:architecture-1",
    direction: "support",
    strength: 0.6,
    reason: "整理了一次建筑相关经历。",
    provenance: "model_generated",
    occurredAt: START,
  }, START);

  const reopened = await JsonStore.open(filePath, false);
  assert.equal(listAiWorldInterestEvidence(reopened, "architecture")[0]?.id, applied.evidence.id);
  assert.equal(listAiWorldPreferenceStates(reopened)[0]?.id, applied.preference.id);

  await advancePersistedAiWorld(reopened, "2026-09-05T18:00:00.000Z", "UTC");
  assert.equal(listAiWorldInterestEvidence(reopened, "architecture")[0]?.id, applied.evidence.id);
  assert.equal(listAiWorldPreferenceStates(reopened)[0]?.id, applied.preference.id);
});

test("OH-30/OH-32/OH-P4: preference writes remain isolated from Earth state and delivery queues", async () => {
  const { store } = await initializedStore("our-home-pref-earth-isolation-");
  const before = store.snapshot();
  const lifeBefore = store.getLifeContext(START).lifeState;

  await addAiWorldInterestEvidence(store, {
    interestKey: "Tea",
    evidenceKey: "experience:tea-1",
    direction: "support",
    strength: 0.5,
    reason: "AI World 内部兴趣证据。",
    provenance: "authored",
    occurredAt: START,
  }, START);
  await reviewDueAiWorldPreferences(store, plusDays(7));

  const after = store.snapshot();
  assert.deepEqual(store.getLifeContext(plusDays(7)).lifeState, lifeBefore);
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.actions, before.actions);
  assert.deepEqual(after.proactiveQueue, before.proactiveQueue);
  assert.deepEqual(after.phoneDeviceRegistrations, before.phoneDeviceRegistrations);
});

test("OH-30/OH-P4: corrupt persisted preference boundaries fail through the generic AI World validator", async () => {
  const { store } = await initializedStore("our-home-pref-corrupt-");
  await addAiWorldInterestEvidence(store, {
    interestKey: "Drawing",
    evidenceKey: "experience:drawing-1",
    direction: "support",
    strength: 0.5,
    reason: "建立一个可验证的偏好状态。",
    provenance: "authored",
    occurredAt: START,
  }, START);

  await store.update((data) => {
    const preference = data.aiWorld?.continuity?.preferences?.[0];
    if (!preference) throw new Error("missing preference fixture");
    (preference as { world: string }).world = "EARTH";
  });

  assert.throws(() => readPersistedAiWorld(store, START), /invalid world boundary/);
});
