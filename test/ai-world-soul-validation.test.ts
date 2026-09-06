import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld, readPersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldInterestEvidence, reviewDueAiWorldPreferences } from "../src/ai-world-preference.js";
import { applyReviewedPreferenceToSoul } from "../src/ai-world-soul.js";
import { JsonStore } from "../src/store.js";

const START = "2026-09-05T10:00:00.000Z";
const REVIEW = "2026-09-12T10:00:00.000Z";

test("OH-03/OH-30: generic AI World reads fail closed on corrupt Soul boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-soul-validator-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");

  for (let index = 0; index < 3; index += 1) {
    await addAiWorldInterestEvidence(store, {
      interestKey: "reading",
      evidenceKey: `support:${index}`,
      direction: "support",
      strength: 1,
      reason: `阅读证据 ${index + 1}`,
      provenance: "authored",
      occurredAt: START,
    }, START);
  }
  await reviewDueAiWorldPreferences(store, REVIEW);
  const applied = await applyReviewedPreferenceToSoul(store, "reading", REVIEW);
  assert.equal(applied.applied, true);

  await store.update((data) => {
    const tendency = data.aiWorld?.continuity?.soulTendencies?.[0];
    if (!tendency) throw new Error("missing Soul tendency fixture");
    (tendency as { world: string }).world = "EARTH";
  });

  assert.throws(() => readPersistedAiWorld(store, REVIEW), /Soul tendency has an invalid world boundary/);
});

test("OH-03: generic AI World reads reject Soul audit changes above the hard delta cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-soul-delta-validator-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");

  for (let index = 0; index < 3; index += 1) {
    await addAiWorldInterestEvidence(store, {
      interestKey: "reading",
      evidenceKey: `support:${index}`,
      direction: "support",
      strength: 1,
      reason: `阅读证据 ${index + 1}`,
      provenance: "authored",
      occurredAt: START,
    }, START);
  }
  await reviewDueAiWorldPreferences(store, REVIEW);
  const applied = await applyReviewedPreferenceToSoul(store, "reading", REVIEW);
  assert.equal(applied.applied, true);

  await store.update((data) => {
    const change = data.aiWorld?.continuity?.soulChanges?.[0];
    if (!change) throw new Error("missing Soul change fixture");
    change.afterScore = 0.5;
    change.delta = 0.5;
  });

  assert.throws(() => readPersistedAiWorld(store, REVIEW), /exceeds the hard delta cap/);
});
