import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import {
  addAiWorldExperience,
  addAiWorldNote,
  addAiWorldThoughtThread,
  listDueAiWorldReviews,
  readAiWorldContinuity,
  updateAiWorldNote,
  updateAiWorldThoughtThread,
} from "../src/ai-world-continuity.js";
import { JsonStore } from "../src/store.js";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  return { store, filePath };
}

test("OH-22/OH-P4: Experience, Note/Journal and Thought Thread persist as explicit AI World continuity", async () => {
  const { store } = await initializedStore("our-home-continuity-types-");
  const experience = await addAiWorldExperience(store, {
    summary: "在书房整理了今天留下的计划。",
    occurredAt: "2026-09-05T10:01:00.000Z",
    provenance: "authored",
    evidenceRefs: ["ai-world:item:plan-1"],
    nextReviewAt: "2026-09-06T10:00:00.000Z",
  }, "2026-09-05T10:02:00.000Z");
  const note = await addAiWorldNote(store, {
    kind: "journal",
    title: "今天的记录",
    body: "把做过的事留下一个可复用的摘要。",
    provenance: "authored",
  }, "2026-09-05T10:03:00.000Z");
  const thread = await addAiWorldThoughtThread(store, {
    title: "书房怎么继续整理",
    summary: "已经整理出第一批需要处理的内容。",
    openQuestion: "下一次先整理书还是收藏？",
    provenance: "model_generated",
    nextReviewAt: "2026-09-05T18:00:00.000Z",
  }, "2026-09-05T10:04:00.000Z");

  assert.deepEqual([experience.world, experience.source], ["AI_WORLD", "AGENT_LIFE"]);
  assert.deepEqual([note.world, note.source, note.kind], ["AI_WORLD", "AGENT_LIFE", "journal"]);
  assert.deepEqual([thread.world, thread.source, thread.status], ["AI_WORLD", "AGENT_LIFE", "active"]);
  const continuity = readAiWorldContinuity(store);
  assert.deepEqual(
    [continuity.experiences.length, continuity.notes.length, continuity.thoughtThreads.length],
    [1, 1, 1],
  );
});

test("OH-22: Thought Thread cannot become hidden chain-of-thought storage through extra input fields", async () => {
  const { store } = await initializedStore("our-home-continuity-no-cot-");
  const input = {
    title: "一个可复用问题",
    summary: "只保存未来真正需要继续的摘要。",
    conclusion: "目前没有定论。",
    provenance: "model_generated" as const,
    reasoning: "private hidden reasoning should never be persisted",
    chainOfThought: ["step 1", "step 2"],
  };
  const thread = await addAiWorldThoughtThread(store, input, "2026-09-05T10:05:00.000Z");
  const stored = readAiWorldContinuity(store).thoughtThreads[0]! as unknown as Record<string, unknown>;

  assert.equal(thread.summary, "只保存未来真正需要继续的摘要。");
  assert.equal("reasoning" in stored, false);
  assert.equal("chainOfThought" in stored, false);
});

test("OH-64/OH-65/OH-P4: nextReviewAt maturity is deterministic, sorted and read-only", async () => {
  const { store } = await initializedStore("our-home-continuity-review-");
  const note = await addAiWorldNote(store, {
    kind: "note",
    title: "晚点再看",
    body: "这条稍后回看。",
    provenance: "authored",
    nextReviewAt: "2026-09-05T13:00:00.000Z",
  }, "2026-09-05T10:01:00.000Z");
  const thread = await addAiWorldThoughtThread(store, {
    title: "先回看这个",
    summary: "它应该更早到期。",
    provenance: "authored",
    nextReviewAt: "2026-09-05T12:00:00.000Z",
  }, "2026-09-05T10:02:00.000Z");
  await addAiWorldExperience(store, {
    summary: "明天才需要复盘。",
    occurredAt: "2026-09-05T10:00:00.000Z",
    provenance: "simulated",
    nextReviewAt: "2026-09-06T10:00:00.000Z",
  }, "2026-09-05T10:03:00.000Z");

  const before = store.snapshot().aiWorld;
  const due = listDueAiWorldReviews(store, "2026-09-05T14:00:00.000Z");
  assert.deepEqual(due.map((item) => item.recordId), [thread.id, note.id]);
  assert.deepEqual(store.snapshot().aiWorld, before);

  await updateAiWorldThoughtThread(store, thread.id, { status: "archived" }, "2026-09-05T14:01:00.000Z");
  assert.deepEqual(listDueAiWorldReviews(store, "2026-09-05T14:02:00.000Z").map((item) => item.recordId), [note.id]);
});

test("OH-P4: continuity survives restart and deterministic AI World phase progression", async () => {
  const { store, filePath } = await initializedStore("our-home-continuity-restart-");
  const experience = await addAiWorldExperience(store, {
    summary: "上午留下的经历。",
    occurredAt: "2026-09-05T10:00:00.000Z",
    provenance: "authored",
  }, "2026-09-05T10:10:00.000Z");
  const thread = await addAiWorldThoughtThread(store, {
    title: "下午继续",
    summary: "这条 Thread 不能被状态机推进丢掉。",
    provenance: "authored",
  }, "2026-09-05T10:11:00.000Z");

  await advancePersistedAiWorld(store, "2026-09-05T18:00:00.000Z", "UTC");
  const reopened = await JsonStore.open(filePath, false);
  const continuity = readAiWorldContinuity(reopened);
  assert.equal(continuity.experiences[0]?.id, experience.id);
  assert.equal(continuity.thoughtThreads[0]?.id, thread.id);
  assert.equal(reopened.snapshot().aiWorld?.state.currentActivity, "free_time");
});

test("OH-30/OH-31/OH-32: continuity updates preserve boundary/provenance and cannot alter Earth controls", async () => {
  const { store } = await initializedStore("our-home-continuity-isolation-");
  const beforeLife = store.getLifeContext("2026-09-05T10:00:00.000Z").lifeState;
  const beforeQueue = store.snapshot().proactiveQueue;

  const note = await addAiWorldNote(store, {
    kind: "note",
    title: "边界测试",
    body: "这是 AI World 内部笔记。",
    provenance: "model_generated",
  }, "2026-09-05T10:01:00.000Z");
  const updated = await updateAiWorldNote(store, note.id, {
    body: "只改变笔记内容，不改变真假边界。",
    nextReviewAt: "2026-09-06T10:00:00.000Z",
  }, "2026-09-05T10:02:00.000Z");

  assert.deepEqual(
    [updated.world, updated.provenance, updated.source, updated.kind],
    ["AI_WORLD", "model_generated", "AGENT_LIFE", "note"],
  );
  assert.deepEqual(store.getLifeContext("2026-09-05T10:03:00.000Z").lifeState, beforeLife);
  assert.deepEqual(store.snapshot().proactiveQueue, beforeQueue);
  assert.equal(store.snapshot().observations.length, 0);
});

test("OH-22/OH-32: invalid review time and corrupted continuity boundary fail closed", async () => {
  const { store } = await initializedStore("our-home-continuity-fail-closed-");
  await assert.rejects(
    addAiWorldNote(store, {
      kind: "note",
      title: "错误时间",
      body: "review 不能早于创建。",
      provenance: "authored",
      nextReviewAt: "2026-09-05T09:00:00.000Z",
    }, "2026-09-05T10:00:00.000Z"),
    /nextReviewAt cannot precede/,
  );

  const thread = await addAiWorldThoughtThread(store, {
    title: "边界损坏测试",
    summary: "先写入合法记录。",
    provenance: "authored",
  }, "2026-09-05T10:01:00.000Z");
  await store.update((data) => {
    const stored = data.aiWorld?.continuity?.thoughtThreads.find((item) => item.id === thread.id);
    if (!stored) throw new Error("missing test thread");
    (stored as { world: string }).world = "EARTH";
  });
  assert.throws(() => readAiWorldContinuity(store), /invalid world boundary/);
});
