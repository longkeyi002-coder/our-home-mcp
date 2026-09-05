import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import { runProactiveCycle } from "../src/worker.js";
import {
  enqueueVisualResultWakeEvents,
  VISUAL_RESULT_WAKE_TTL_MS,
} from "../src/visual-result-wake.js";
import type { BrainAdapter } from "../src/brain.js";
import type { ProactiveCandidate } from "../src/types.js";

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-visual-result-"));
  return JsonStore.open(join(dir, "data.json"), false);
}

async function recordCompletedVisual(
  store: JsonStore,
  overrides: { packageName?: string; sessionId?: string; deviceId?: string } = {},
) {
  const opportunity = {
    deviceId: "android-1",
    packageName: "com.example.game",
    sessionId: `com.example.game:${Date.parse("2026-09-05T12:00:00.000Z")}`,
    curiosityReason: "unknown_dwell",
    observedAt: "2026-09-05T12:10:00.000Z",
    expiresAt: "2026-09-05T12:15:00.000Z",
  };
  const wake = await store.enqueueVisualOpportunity(opportunity);
  await store.applyWakeDecision(
    wake.id,
    { action: "request_visual", reason: "one glance would resolve context" },
    "2026-09-05T12:11:00.000Z",
  );
  const request = (store.snapshot().visualRequests ?? [])[0]!;

  await store.recordObservation({
    kind: "visual_observation_summary",
    label: "gaming",
    value: "gameplay visible",
    observedAt: "2026-09-05T12:11:20.000Z",
    source: "phone",
    confidence: "observed",
    world: "EARTH",
    provenance: "observed",
    deviceId: overrides.deviceId ?? opportunity.deviceId,
    metadata: {
      packageName: overrides.packageName ?? opportunity.packageName,
      activity: "gaming",
      confidence: 0.9,
      provider: "test",
      model: "test-vision",
      requestId: request.requestId,
      sessionId: overrides.sessionId ?? opportunity.sessionId,
    },
  });

  return { request, opportunity };
}

test("OH-44/OH-47: a matching visual summary creates exactly one separate Care wake", async () => {
  const store = await createStore();
  const { request } = await recordCompletedVisual(store);

  const first = await enqueueVisualResultWakeEvents(store, "2026-09-05T12:12:00.000Z");
  const second = await enqueueVisualResultWakeEvents(store, "2026-09-05T12:12:30.000Z");

  assert.equal(first.length, 1);
  assert.equal(first[0]?.type, "visual_result");
  assert.equal(first[0]?.dedupeKey, `visual_result:${request.requestId}`);
  assert.equal(second.length, 0);
  assert.equal(
    store.snapshot().wakeEvents.filter((item) => item.type === "visual_result").length,
    1,
  );
});

test("OH-45: a mismatched package/session summary cannot create a visual-result Care wake", async () => {
  const store = await createStore();
  await recordCompletedVisual(store, { packageName: "com.example.other" });

  const created = await enqueueVisualResultWakeEvents(store, "2026-09-05T12:12:00.000Z");

  assert.equal(created.length, 0);
  assert.equal(store.snapshot().wakeEvents.some((item) => item.type === "visual_result"), false);
});

test("OH-44: after looking, Brain separately decides whether to contact the user", async () => {
  const store = await createStore();
  await recordCompletedVisual(store);
  const evaluatedTypes: string[] = [];
  const delivered: ProactiveCandidate[] = [];
  const brain: BrainAdapter = {
    async evaluate(input) {
      evaluatedTypes.push(input.wakeEvent.type);
      return {
        action: "proactive_message",
        candidate: {
          title: "还在玩吗？",
          message: "看起来你还在游戏里，需要我陪你聊会儿吗？",
          reason: "The completed visual result made a gentle check-in worthwhile",
        },
      };
    },
  };

  const result = await runProactiveCycle(
    store,
    { deliver: async (candidate) => { delivered.push(candidate); } },
    new Date("2026-09-05T12:12:00.000Z"),
    brain,
  );

  assert.deepEqual(evaluatedTypes, ["visual_result"]);
  assert.equal(result.deliveredCount, 1);
  assert.equal(delivered.length, 1);
  const visualWake = store.snapshot().wakeEvents.find((item) => item.type === "visual_result");
  assert.equal(visualWake?.status, "handled");
  assert.equal(store.snapshot().proactiveQueue[0]?.wakeEventId, visualWake?.id);
});

test("OH-44/OH-47: a stale visual-result wake is dismissed without calling Brain", async () => {
  const store = await createStore();
  await recordCompletedVisual(store);
  const created = await enqueueVisualResultWakeEvents(store, "2026-09-05T12:12:00.000Z");
  assert.equal(created.length, 1);

  const calls: string[] = [];
  const brain: BrainAdapter = {
    async evaluate(input) {
      calls.push(input.wakeEvent.id);
      return { action: "ignore" };
    },
  };
  const expiredAt = new Date(Date.parse("2026-09-05T12:11:20.000Z") + VISUAL_RESULT_WAKE_TTL_MS + 1_000);

  await runProactiveCycle(store, { deliver: async () => {} }, expiredAt, brain);

  assert.equal(calls.length, 0);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === created[0]!.id)?.status, "dismissed");
});
