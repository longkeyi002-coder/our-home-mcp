import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld, readPersistedAiWorld } from "../src/ai-world-store.js";
import { createAiWorldData, advanceAiWorldData } from "../src/ai-world.js";
import { JsonStore, type StoreFileSystem } from "../src/store.js";

function countingFileSystem(counter: { writes: number }): StoreFileSystem {
  return {
    writeFile: (async (...args: unknown[]) => {
      counter.writes += 1;
      return (writeFile as unknown as (...inner: unknown[]) => Promise<void>)(...args);
    }) as StoreFileSystem["writeFile"],
  };
}

test("OH-P3: persisted AI World initializes once and same-phase advances add no store write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-world-store-"));
  const counter = { writes: 0 };
  const store = await JsonStore.open(join(directory, "data.json"), false, countingFileSystem(counter));
  const afterOpen = counter.writes;

  const initialized = await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  assert.equal(counter.writes, afterOpen + 1);
  assert.equal(initialized.state.phaseKey, "2026-09-05:focused_work");

  const samePhase = await advancePersistedAiWorld(store, "2026-09-05T11:30:00.000Z", "UTC");
  assert.equal(counter.writes, afterOpen + 1);
  assert.equal(samePhase.clockAt, "2026-09-05T11:30:00.000Z");
  assert.equal(samePhase.state.updatedAt, "2026-09-05T10:00:00.000Z");
});

test("OH-P3: a semantic phase transition persists history and survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-world-restart-"));
  const filePath = join(directory, "data.json");
  let store = await JsonStore.open(filePath, false);

  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  const midday = await advancePersistedAiWorld(store, "2026-09-05T12:00:00.000Z", "UTC");
  assert.equal(midday.state.currentActivity, "midday_break");
  assert.equal(midday.recentHistory.length, 2);

  store = await JsonStore.open(filePath, false);
  const restored = readPersistedAiWorld(store, "2026-09-05T12:30:00.000Z");
  assert.equal(restored?.state.currentActivity, "midday_break");
  assert.equal(restored?.recentHistory.length, 2);

  const evening = await advancePersistedAiWorld(store, "2026-09-05T18:00:00.000Z", "UTC");
  assert.equal(evening.state.currentActivity, "free_time");
  assert.equal(evening.recentHistory.length, 3);
});

test("OH-P3: restart catch-up reaches the same canonical state as direct deterministic progression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-world-catchup-"));
  const filePath = join(directory, "data.json");
  let store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  await advancePersistedAiWorld(store, "2026-09-05T12:00:00.000Z", "UTC");

  store = await JsonStore.open(filePath, false);
  const afterRestart = await advancePersistedAiWorld(store, "2026-09-05T18:00:00.000Z", "UTC");

  const directStart = createAiWorldData("2026-09-05T10:00:00.000Z", "UTC");
  const direct = advanceAiWorldData(directStart, "2026-09-05T18:00:00.000Z").data;
  assert.deepEqual(
    {
      phaseKey: afterRestart.state.phaseKey,
      room: afterRestart.state.room,
      weather: afterRestart.state.weather,
      workState: afterRestart.state.workState,
      currentActivity: afterRestart.state.currentActivity,
    },
    {
      phaseKey: direct.state.phaseKey,
      room: direct.state.room,
      weather: direct.state.weather,
      workState: direct.state.workState,
      currentActivity: direct.state.currentActivity,
    },
  );
});

test("OH-30/OH-32: persisted AI World cannot be read after its boundary is corrupted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-ai-world-corrupt-"));
  const filePath = join(directory, "data.json");
  const store = await JsonStore.open(filePath, false);
  await advancePersistedAiWorld(store, "2026-09-05T10:00:00.000Z", "UTC");
  await store.update((data) => {
    if (!data.aiWorld) throw new Error("missing test AI World");
    (data.aiWorld.state as { world: string }).world = "EARTH";
  });
  assert.throws(
    () => readPersistedAiWorld(store, "2026-09-05T10:30:00.000Z"),
    /invalid world boundary/,
  );
});
