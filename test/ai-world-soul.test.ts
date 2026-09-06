import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldInterestEvidence, reviewDueAiWorldPreferences } from "../src/ai-world-preference.js";
import {
  MAX_SOUL_DELTA,
  MIN_SOUL_EVIDENCE_COUNT,
  SOUL_DAILY_DECAY,
  applyReviewedPreferenceToSoul,
  listAiWorldSoulChanges,
  listAiWorldSoulTendencies,
  reviewDueAiWorldSoul,
} from "../src/ai-world-soul.js";
import { JsonStore } from "../src/store.js";

const START = "2026-09-05T10:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;

function plusDays(days: number): string {
  return new Date(Date.parse(START) + days * DAY_MS).toISOString();
}

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, START, "UTC");
  return { store, filePath };
}

async function addSupportEvidence(store: JsonStore, interestKey: string, count: number, asOf = START) {
  for (let index = 0; index < count; index += 1) {
    await addAiWorldInterestEvidence(store, {
      interestKey,
      evidenceKey: `support:${index}`,
      direction: "support",
      strength: 1,
      reason: `正向兴趣证据 ${index + 1}`,
      provenance: "authored",
      occurredAt: asOf,
    }, asOf);
  }
}

async function addCounterEvidence(store: JsonStore, interestKey: string, count: number, asOf: string) {
  for (let index = 0; index < count; index += 1) {
    await addAiWorldInterestEvidence(store, {
      interestKey,
      evidenceKey: `counter:${index}`,
      direction: "counter",
      strength: 1,
      reason: `反向兴趣证据 ${index + 1}`,
      provenance: "authored",
      occurredAt: asOf,
    }, asOf);
  }
}

async function establishPositiveSoul(store: JsonStore, interestKey = "reading") {
  await addSupportEvidence(store, interestKey, MIN_SOUL_EVIDENCE_COUNT);
  await reviewDueAiWorldPreferences(store, plusDays(7));
  const applied = await applyReviewedPreferenceToSoul(store, interestKey, plusDays(7));
  assert.equal(applied.applied, true);
  assert.equal(applied.tendency?.score, MAX_SOUL_DELTA);
  return applied;
}

test("OH-03/OH-P4: one interaction cannot directly alter Soul", async () => {
  const { store } = await initializedStore("our-home-soul-one-evidence-");
  await addSupportEvidence(store, "reading", 1);
  await reviewDueAiWorldPreferences(store, plusDays(7));

  const result = await applyReviewedPreferenceToSoul(store, "reading", plusDays(7));
  assert.equal(result.applied, false);
  assert.equal(result.reason, "insufficient_evidence");
  assert.equal(listAiWorldSoulTendencies(store).length, 0);
  assert.equal(listAiWorldSoulChanges(store).length, 0);
});

test("OH-03/OH-P4: multiple evidence still cannot alter Soul before explicit preference review", async () => {
  const { store } = await initializedStore("our-home-soul-needs-review-");
  await addSupportEvidence(store, "reading", MIN_SOUL_EVIDENCE_COUNT);

  const result = await applyReviewedPreferenceToSoul(store, "reading", START);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "preference_not_reviewed");
  assert.equal(listAiWorldSoulTendencies(store).length, 0);
});

test("OH-03/OH-P4: reviewed multi-evidence preference changes Soul by at most the hard delta", async () => {
  const { store } = await initializedStore("our-home-soul-bounded-");
  const applied = await establishPositiveSoul(store, "reading");

  assert.equal(applied.change?.reason, "preference_evidence");
  assert.equal(applied.change?.beforeScore, 0);
  assert.equal(applied.change?.afterScore, MAX_SOUL_DELTA);
  assert.equal(applied.change?.delta, MAX_SOUL_DELTA);
  assert.ok(Math.abs(applied.change?.delta ?? 1) <= MAX_SOUL_DELTA);
  assert.equal(applied.tendency?.evidenceCount, MIN_SOUL_EVIDENCE_COUNT);
  assert.equal(applied.change?.basisEvidenceIds?.length, MIN_SOUL_EVIDENCE_COUNT);
  assert.ok(applied.change?.basisKey?.startsWith("soul-basis:"));
});

test("OH-03/OH-P4: re-reviewing the same canonical evidence set cannot reinforce Soul twice", async () => {
  const { store } = await initializedStore("our-home-soul-basis-dedupe-");
  const first = await establishPositiveSoul(store, "reading");
  await reviewDueAiWorldPreferences(store, plusDays(14));

  const duplicate = await applyReviewedPreferenceToSoul(store, "reading", plusDays(14));
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, "duplicate_basis");
  assert.equal(listAiWorldSoulTendencies(store)[0]?.score, first.tendency?.score);
  assert.equal(listAiWorldSoulChanges(store, "reading").filter((item) => item.reason === "preference_evidence").length, 1);
});

test("OH-03/OH-P4: new counter evidence requires a new review and can only correct Soul gradually", async () => {
  const { store } = await initializedStore("our-home-soul-counter-");
  await establishPositiveSoul(store, "reading");

  await addCounterEvidence(store, "reading", 5, plusDays(8));
  const beforeReview = await applyReviewedPreferenceToSoul(store, "reading", plusDays(8));
  assert.equal(beforeReview.applied, false);
  assert.equal(beforeReview.reason, "review_predates_latest_evidence");
  assert.equal(listAiWorldSoulTendencies(store)[0]?.score, MAX_SOUL_DELTA);

  await reviewDueAiWorldPreferences(store, plusDays(15));
  const correction = await applyReviewedPreferenceToSoul(store, "reading", plusDays(15));
  assert.equal(correction.applied, true);
  assert.equal(correction.change?.delta, -MAX_SOUL_DELTA);
  assert.equal(correction.change?.beforeScore, MAX_SOUL_DELTA);
  assert.equal(correction.change?.afterScore, 0);
  assert.equal(correction.tendency?.score, 0);
  assert.equal(correction.tendency?.evidenceCount, 8);
});

test("OH-03/OH-65: Soul decays much more slowly than temporary preference state", async () => {
  const { store } = await initializedStore("our-home-soul-decay-");
  await establishPositiveSoul(store, "reading");

  const reviewed = await reviewDueAiWorldSoul(store, plusDays(37));
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0]?.score, MAX_SOUL_DELTA - 30 * SOUL_DAILY_DECAY);
  assert.equal(reviewed[0]?.lastReviewedAt, plusDays(37));

  const changes = listAiWorldSoulChanges(store, "reading");
  const decay = changes.find((item) => item.reason === "time_decay");
  assert.ok(decay);
  assert.equal(decay?.beforeScore, MAX_SOUL_DELTA);
  assert.equal(decay?.afterScore, MAX_SOUL_DELTA - 30 * SOUL_DAILY_DECAY);
  assert.equal(decay?.delta, -(30 * SOUL_DAILY_DECAY));
});

test("OH-P4: Soul state and audit history survive restart and P3 world progression", async () => {
  const { store, filePath } = await initializedStore("our-home-soul-restart-");
  const applied = await establishPositiveSoul(store, "architecture");

  const reopened = await JsonStore.open(filePath, false);
  assert.equal(listAiWorldSoulTendencies(reopened)[0]?.id, applied.tendency?.id);
  assert.equal(listAiWorldSoulChanges(reopened)[0]?.id, applied.change?.id);

  await advancePersistedAiWorld(reopened, plusDays(8), "UTC");
  assert.equal(listAiWorldSoulTendencies(reopened)[0]?.id, applied.tendency?.id);
  assert.equal(listAiWorldSoulChanges(reopened)[0]?.id, applied.change?.id);
});

test("OH-30/OH-32/OH-P4: Soul changes remain isolated from Earth state and delivery queues", async () => {
  const { store } = await initializedStore("our-home-soul-earth-isolation-");
  const before = store.snapshot();
  const lifeBefore = store.getLifeContext(START).lifeState;

  await establishPositiveSoul(store, "reading");
  await reviewDueAiWorldSoul(store, plusDays(37));

  const after = store.snapshot();
  assert.deepEqual(store.getLifeContext(plusDays(37)).lifeState, lifeBefore);
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.actions, before.actions);
  assert.deepEqual(after.proactiveQueue, before.proactiveQueue);
  assert.deepEqual(after.phoneDeviceRegistrations, before.phoneDeviceRegistrations);
});

test("OH-03/OH-P4: Soul change cannot be backdated before the preference review", async () => {
  const { store } = await initializedStore("our-home-soul-backdate-");
  await addSupportEvidence(store, "reading", MIN_SOUL_EVIDENCE_COUNT);
  await reviewDueAiWorldPreferences(store, plusDays(7));

  await assert.rejects(
    applyReviewedPreferenceToSoul(store, "reading", plusDays(6)),
    /cannot precede preference review/,
  );
  assert.equal(listAiWorldSoulTendencies(store).length, 0);
});
