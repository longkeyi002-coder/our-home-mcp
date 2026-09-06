import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import { listAiWorldSoulChanges, listAiWorldSoulTendencies } from "../src/ai-world-soul.js";
import { quietHoursPolicyFromEnv } from "../src/quiet-hours.js";
import { JsonStore } from "../src/store.js";
import { recordAndApplyUserFeedback } from "../src/user-feedback.js";
import { NoopNotifier, runProactiveCycle } from "../src/worker.js";

const START = "2026-09-05T10:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1_000;
const DAY7 = new Date(Date.parse(START) + 7 * DAY_MS).toISOString();
const DAY37 = new Date(Date.parse(START) + 37 * DAY_MS).toISOString();

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(store, START, "UTC");
  return store;
}

async function seedFeedbackPreference(store: JsonStore) {
  for (let index = 0; index < 5; index += 1) {
    await recordAndApplyUserFeedback(store, {
      feedbackKey: `worker:reading:${index}`,
      interestKey: "reading",
      signal: "prefer_more",
      occurredAt: START,
    }, START);
  }
}

test("OH-03/OH-64/OH-P4: Life Loop autonomously reviews due Preference and applies only bounded Soul change", async () => {
  const store = await initializedStore("our-home-identity-worker-review-");
  await seedFeedbackPreference(store);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.score, 0.125);
  assert.equal(listAiWorldSoulTendencies(store).length, 0);

  await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(DAY7),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
  );

  const preference = listAiWorldPreferenceStates(store)[0];
  assert.equal(preference?.score, 0.09);
  assert.equal(preference?.lastReviewedAt, DAY7);
  const soul = listAiWorldSoulTendencies(store)[0];
  assert.equal(soul?.score, 0.02);
  assert.equal(soul?.lastChangedAt, DAY7);
  assert.equal(listAiWorldSoulChanges(store, "reading").length, 1);
});

test("OH-03/OH-64/OH-P4: Life Loop performs slow Soul decay later without Brain calls", async () => {
  const store = await initializedStore("our-home-identity-worker-decay-");
  await seedFeedbackPreference(store);
  await runProactiveCycle(store, new NoopNotifier(), new Date(DAY7), undefined, quietHoursPolicyFromEnv({}), "UTC");
  assert.equal(listAiWorldSoulTendencies(store)[0]?.score, 0.02);

  // No cycles are required between day 7 and day 37: catch-up uses absolute timestamps.
  await runProactiveCycle(store, new NoopNotifier(), new Date(DAY37), undefined, quietHoursPolicyFromEnv({}), "UTC");

  const soul = listAiWorldSoulTendencies(store)[0];
  assert.equal(soul?.score, 0.014);
  assert.equal(soul?.lastReviewedAt, DAY37);
  const changes = listAiWorldSoulChanges(store, "reading");
  assert.equal(changes.some((item) => item.reason === "time_decay" && item.delta === -0.006), true);
});

test("OH-67/OH-P4: corrupt identity maintenance cannot stop Earth heartbeat worker life", async () => {
  const store = await initializedStore("our-home-identity-worker-isolation-");
  const heartbeatBefore = store.snapshot().heartbeats.length;

  await store.update((data) => {
    if (!data.aiWorld) throw new Error("AI World missing");
    data.aiWorld.continuity ??= { experiences: [], notes: [], thoughtThreads: [] };
    data.aiWorld.continuity.preferences = [{
      id: "bad-preference",
      world: "AI_WORLD",
      provenance: "inferred",
      source: "AGENT_LIFE",
      interestKey: "corrupt",
      score: 2,
      evidenceCount: 1,
      evidenceIds: ["missing-evidence"],
      lastEvidenceAt: START,
      lastEvaluatedAt: START,
      nextReviewAt: START,
      createdAt: START,
      updatedAt: START,
    }];
  });

  await runProactiveCycle(
    store,
    new NoopNotifier(),
    new Date(DAY7),
    undefined,
    quietHoursPolicyFromEnv({}),
    "UTC",
  );

  assert.ok(store.snapshot().heartbeats.length > heartbeatBefore);
});
