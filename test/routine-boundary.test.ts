import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";

test("OH-30/OH-31: new routine windows are fixed to EARTH/user_declared", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-routine-boundary-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  const routine = await store.addRoutine({
    label: "睡眠时间",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startLocal: "23:00",
    endLocal: "07:00",
    timezone: "Asia/Taipei",
  });

  assert.deepEqual([routine.world, routine.provenance], ["EARTH", "user_declared"]);
  const contextRoutine = store.getLifeContext().routines.find((item) => item.id === routine.id);
  assert.deepEqual([contextRoutine?.world, contextRoutine?.provenance], ["EARTH", "user_declared"]);

  const activity = store.snapshot().activities.find((item) => item.kind === "routine_created");
  assert.deepEqual([activity?.world, activity?.provenance], ["EARTH", "user_declared"]);
});

test("OH-30/OH-31: an older boundary-less routine is normalized only to its known Earth declaration semantics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-routine-legacy-"));
  const filePath = join(directory, "data.json");
  await writeFile(filePath, JSON.stringify({
    schemaVersion: 3,
    diaries: [],
    relationshipEvents: [],
    actions: [],
    activities: [],
    proactiveMessages: [],
    homeState: { presence: "unknown", updatedAt: "2026-09-05T00:00:00.000Z", source: "HOME_STATE" },
    observations: [],
    routines: [{
      id: "legacy-routine",
      label: "工作时间",
      weekdays: [1, 2, 3, 4, 5],
      startLocal: "09:00",
      endLocal: "18:00",
      timezone: "Asia/Taipei",
      enabled: true,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z"
    }],
    heartbeats: [],
    proactiveQueue: [],
    wakeEvents: [],
    wakeEngineState: { lastLifeState: null, lastEventAt: {} },
    phoneDeviceRegistrations: [],
    visualRequests: []
  }), "utf8");

  const store = await JsonStore.open(filePath, false);
  const routine = store.snapshot().routines[0];
  assert.deepEqual([routine?.world, routine?.provenance], ["EARTH", "user_declared"]);
});