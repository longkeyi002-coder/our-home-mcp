import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldExperience, addAiWorldNote, readAiWorldContinuity } from "../src/ai-world-continuity.js";
import {
  REFLECTION_DAILY_ATTEMPT_LIMIT,
  REFLECTION_FAILURE_BACKOFF_MS,
  REFLECTION_IGNORE_RESCHEDULE_MS,
  REFLECTION_RECORD_RESCHEDULE_MS,
  REFLECTION_SUCCESS_COOLDOWN_MS,
  readAiWorldReflectionRuntimeState,
  runAiWorldReflectionCycle,
  type AiWorldReflectionAdapter,
  type AiWorldReflectionInput,
} from "../src/ai-world-reflection.js";
import { JsonStore } from "../src/store.js";

const START = "2026-09-05T10:00:00.000Z";

function plus(ms: number): string {
  return new Date(Date.parse(START) + ms).toISOString();
}

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, START, "UTC");
  return { store, filePath };
}

class RecordingAdapter implements AiWorldReflectionAdapter {
  calls: AiWorldReflectionInput[] = [];
  constructor(private readonly result: unknown) {}
  async evaluate(input: AiWorldReflectionInput): Promise<unknown> {
    this.calls.push(structuredClone(input));
    return this.result;
  }
}

class FailingAdapter implements AiWorldReflectionAdapter {
  calls = 0;
  async evaluate(): Promise<unknown> {
    this.calls += 1;
    throw new Error("provider unavailable");
  }
}

async function dueExperience(store: JsonStore, summary: string) {
  return addAiWorldExperience(store, {
    summary,
    occurredAt: START,
    provenance: "authored",
    nextReviewAt: START,
  }, START);
}

test("OH-64/OH-65/P4.4: no due continuity means zero reflection model calls", async () => {
  const { store } = await initializedStore("our-home-reflection-none-");
  const adapter = new RecordingAdapter({ action: "ignore" });

  const result = await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(result.status, "no_due");
  assert.equal(result.attempted, false);
  assert.equal(adapter.calls.length, 0);
});

test("OH-22/OH-P4: one exact due source can create one public structured reflection only", async () => {
  const { store } = await initializedStore("our-home-reflection-record-");
  const source = await dueExperience(store, "整理一次关于建筑空间的经历");
  const earthBefore = store.snapshot();
  const adapter = new RecordingAdapter({
    action: "record_reflection",
    reflection: {
      title: "空间与安静",
      summary: "我发现自己会持续注意空间如何影响专注。",
      conclusion: "安静且有层次的空间更容易让我持续思考。",
      openQuestion: "以后还会不会被完全不同的空间吸引？",
    },
  });

  const result = await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(result.status, "recorded");
  assert.equal(result.attempted, true);
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0]?.source.recordId, source.id);
  assert.equal(adapter.calls[0]?.source.recordType, "experience");
  assert.equal("lifeState" in (adapter.calls[0] as unknown as Record<string, unknown>), false);

  const continuity = readAiWorldContinuity(store);
  const reflection = continuity.thoughtThreads.find((item) => item.id === result.reflectionThreadId);
  assert.ok(reflection);
  assert.equal(reflection?.provenance, "model_generated");
  assert.equal(reflection?.summary, "我发现自己会持续注意空间如何影响专注。");
  assert.deepEqual(reflection?.evidenceRefs, [`ai-world-review:experience:${source.id}:${START}`]);
  const reviewedSource = continuity.experiences.find((item) => item.id === source.id);
  assert.equal(reviewedSource?.lastReviewedAt, START);
  assert.equal(reviewedSource?.nextReviewAt, plus(REFLECTION_RECORD_RESCHEDULE_MS));

  const earthAfter = store.snapshot();
  assert.deepEqual(earthAfter.observations, earthBefore.observations);
  assert.deepEqual(earthAfter.actions, earthBefore.actions);
  assert.deepEqual(earthAfter.proactiveQueue, earthBefore.proactiveQueue);
  assert.deepEqual(earthAfter.phoneDeviceRegistrations, earthBefore.phoneDeviceRegistrations);
});

test("OH-40/OH-P4: ignore is first-class and creates no reflection content", async () => {
  const { store } = await initializedStore("our-home-reflection-ignore-");
  const source = await addAiWorldNote(store, {
    kind: "note",
    title: "临时笔记",
    body: "这件事到期时可能已经没有继续想的价值。",
    provenance: "authored",
    nextReviewAt: START,
  }, START);
  const beforeThreads = readAiWorldContinuity(store).thoughtThreads.length;
  const adapter = new RecordingAdapter({ action: "ignore" });

  const result = await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(result.status, "ignored");
  assert.equal(adapter.calls.length, 1);
  const continuity = readAiWorldContinuity(store);
  assert.equal(continuity.thoughtThreads.length, beforeThreads);
  assert.equal(continuity.notes.find((item) => item.id === source.id)?.nextReviewAt, plus(REFLECTION_IGNORE_RESCHEDULE_MS));
});

test("OH-22/OH-67: invalid/hidden-reasoning output fails closed and leaves source due", async () => {
  const { store } = await initializedStore("our-home-reflection-invalid-");
  const source = await dueExperience(store, "需要复审但不能保存隐藏推理");
  const adapter = new RecordingAdapter({
    action: "record_reflection",
    reflection: { title: "不应保存", summary: "公开摘要" },
    reasoning: "hidden chain-of-thought",
  });

  const result = await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(result.status, "provider_failed");
  assert.match(result.error ?? "", /bounded decision contract/);
  const continuity = readAiWorldContinuity(store);
  assert.equal(continuity.experiences.find((item) => item.id === source.id)?.nextReviewAt, START);
  assert.equal(continuity.thoughtThreads.length, 0);
  assert.equal(readAiWorldReflectionRuntimeState(store, START).retryAfter, plus(REFLECTION_FAILURE_BACKOFF_MS));
});

test("OH-65/OH-67: provider failure is retry-bounded and daily-budgeted", async () => {
  const { store } = await initializedStore("our-home-reflection-failure-");
  await dueExperience(store, "持续失败时不能每分钟调用模型");
  const adapter = new FailingAdapter();

  const first = await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(first.status, "provider_failed");
  assert.equal(adapter.calls, 1);

  const tooSoon = await runAiWorldReflectionCycle(store, adapter, plus(30 * 60 * 1_000));
  assert.equal(tooSoon.status, "retry_backoff");
  assert.equal(adapter.calls, 1);

  for (let attempt = 2; attempt <= REFLECTION_DAILY_ATTEMPT_LIMIT; attempt += 1) {
    const at = plus((attempt - 1) * REFLECTION_FAILURE_BACKOFF_MS);
    const result = await runAiWorldReflectionCycle(store, adapter, at);
    assert.equal(result.status, "provider_failed");
  }
  assert.equal(adapter.calls, REFLECTION_DAILY_ATTEMPT_LIMIT);

  const budgeted = await runAiWorldReflectionCycle(store, adapter, plus(REFLECTION_DAILY_ATTEMPT_LIMIT * REFLECTION_FAILURE_BACKOFF_MS));
  assert.equal(budgeted.status, "daily_budget");
  assert.equal(adapter.calls, REFLECTION_DAILY_ATTEMPT_LIMIT);
});

test("OH-64/OH-65: successful reflection enforces six-hour cognition cooldown and one source per cycle", async () => {
  const { store } = await initializedStore("our-home-reflection-cooldown-");
  await dueExperience(store, "due A");
  await dueExperience(store, "due B");
  const adapter = new RecordingAdapter({ action: "ignore" });

  const first = await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(first.status, "ignored");
  assert.equal(adapter.calls.length, 1);
  assert.equal(readAiWorldContinuity(store).experiences.filter((item) => item.nextReviewAt === START).length, 1);

  const blocked = await runAiWorldReflectionCycle(store, adapter, plus(REFLECTION_SUCCESS_COOLDOWN_MS - 1));
  assert.equal(blocked.status, "success_cooldown");
  assert.equal(adapter.calls.length, 1);

  const second = await runAiWorldReflectionCycle(store, adapter, plus(REFLECTION_SUCCESS_COOLDOWN_MS));
  assert.equal(second.status, "ignored");
  assert.equal(adapter.calls.length, 2);
});

test("OH-64/OH-P4: reflection runtime cooldown survives JSON restart", async () => {
  const { store, filePath } = await initializedStore("our-home-reflection-restart-");
  await dueExperience(store, "first due");
  await dueExperience(store, "second due");
  const adapter = new RecordingAdapter({ action: "ignore" });
  await runAiWorldReflectionCycle(store, adapter, START);
  assert.equal(adapter.calls.length, 1);

  const reopened = await JsonStore.open(filePath, false);
  const nextAdapter = new RecordingAdapter({ action: "ignore" });
  const result = await runAiWorldReflectionCycle(reopened, nextAdapter, plus(60 * 60 * 1_000));
  assert.equal(result.status, "success_cooldown");
  assert.equal(nextAdapter.calls.length, 0);
  assert.equal(readAiWorldReflectionRuntimeState(reopened, plus(60 * 60 * 1_000)).lastCompletedAt, START);
});
