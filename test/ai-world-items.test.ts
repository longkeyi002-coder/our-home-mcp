import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { addAiWorldItem, listAiWorldItems, updateAiWorldItem } from "../src/ai-world-items.js";
import { JsonStore } from "../src/store.js";
import type { AiWorldItemKind } from "../src/types.js";

const kinds: AiWorldItemKind[] = ["task", "waiting", "plan", "hobby", "interest", "collection"];

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  return { store, filePath };
}

test("OH-11/OH-P3: all six continuity collection kinds persist as structured AI World records", async () => {
  const { store } = await initializedStore("our-home-ai-items-");
  for (const [index, kind] of kinds.entries()) {
    await addAiWorldItem(store, {
      kind,
      title: `${kind} ${index}`,
      provenance: index % 2 === 0 ? "authored" : "model_generated",
    }, `2026-09-05T10:0${index}:00.000Z`);
  }

  const items = listAiWorldItems(store);
  assert.equal(items.length, 6);
  assert.deepEqual(new Set(items.map((item) => item.kind)), new Set(kinds));
  assert.equal(items.every((item) => item.world === "AI_WORLD" && item.source === "AGENT_LIFE"), true);
  assert.equal(listAiWorldItems(store, { kind: "task" }).length, 1);
  assert.equal(listAiWorldItems(store, { kind: "collection" }).length, 1);
});

test("OH-30/OH-31: lifecycle updates preserve kind, world, provenance and source", async () => {
  const { store } = await initializedStore("our-home-ai-item-update-");
  const created = await addAiWorldItem(store, {
    kind: "plan",
    title: "整理书房",
    note: "先列出需要整理的部分",
    provenance: "authored",
  }, "2026-09-05T10:05:00.000Z");

  const updated = await updateAiWorldItem(store, created.id, {
    title: "整理书房和收藏",
    status: "completed",
    note: null,
  }, "2026-09-05T10:20:00.000Z");

  assert.equal(updated.title, "整理书房和收藏");
  assert.equal(updated.status, "completed");
  assert.equal(updated.note, undefined);
  assert.deepEqual(
    [updated.kind, updated.world, updated.provenance, updated.source],
    [created.kind, created.world, created.provenance, created.source],
  );
  assert.equal(listAiWorldItems(store, { status: "completed" })[0]?.id, created.id);
});

test("OH-P3: continuity items survive store restart", async () => {
  const { store, filePath } = await initializedStore("our-home-ai-item-restart-");
  const created = await addAiWorldItem(store, {
    kind: "interest",
    title: "城市夜景",
    provenance: "authored",
  }, "2026-09-05T10:10:00.000Z");

  const reopened = await JsonStore.open(filePath, false);
  const restored = listAiWorldItems(reopened, { kind: "interest" });
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.id, created.id);
  assert.equal(restored[0]?.title, "城市夜景");
});

test("OH-P3: deterministic time progression preserves continuity items", async () => {
  const { store } = await initializedStore("our-home-ai-item-progress-");
  const created = await addAiWorldItem(store, {
    kind: "waiting",
    title: "等一本书送到",
    provenance: "simulated",
  }, "2026-09-05T10:10:00.000Z");

  await advancePersistedAiWorld(store, "2026-09-05T18:00:00.000Z", "UTC");
  assert.equal(store.snapshot().aiWorld?.state.currentActivity, "free_time");
  assert.equal(listAiWorldItems(store)[0]?.id, created.id);
});

test("OH-32/OH-P3: AI World item mutations cannot alter Earth Life State", async () => {
  const { store } = await initializedStore("our-home-ai-item-earth-isolation-");
  const before = store.getLifeContext("2026-09-05T10:00:00.000Z").lifeState;

  await addAiWorldItem(store, {
    kind: "task",
    title: "AI World 内部任务",
    provenance: "model_generated",
  }, "2026-09-05T10:01:00.000Z");
  const item = listAiWorldItems(store, { kind: "task" })[0]!;
  await updateAiWorldItem(store, item.id, { status: "completed" }, "2026-09-05T10:02:00.000Z");

  const after = store.getLifeContext("2026-09-05T10:02:00.000Z").lifeState;
  assert.deepEqual(after, before);
});

test("OH-32: malformed persisted AI World item boundaries fail closed", async () => {
  const { store } = await initializedStore("our-home-ai-item-corrupt-");
  await addAiWorldItem(store, {
    kind: "hobby",
    title: "阅读",
    provenance: "authored",
  }, "2026-09-05T10:05:00.000Z");
  await store.update((data) => {
    const item = data.aiWorld?.items?.[0];
    if (!item) throw new Error("missing test item");
    (item as { world: string }).world = "EARTH";
  });

  assert.throws(() => listAiWorldItems(store), /invalid world boundary/);
});
