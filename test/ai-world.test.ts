import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceAiWorldData,
  assertValidAiWorldData,
  createAiWorldData,
  snapshotAiWorld,
} from "../src/ai-world.js";

test("OH-P3: AI World initializes as explicit AI_WORLD/simulated state with synchronized read clock", () => {
  const createdAt = "2026-09-05T10:00:00.000Z";
  const data = createAiWorldData(createdAt, "UTC");
  assert.deepEqual([data.state.world, data.state.provenance], ["AI_WORLD", "simulated"]);
  assert.equal(data.state.phaseKey, "2026-09-05:focused_work");
  assert.equal(data.state.room, "study");
  assert.equal(data.state.workState, "working");
  assert.equal(data.history[0]?.kind, "initialized");

  const snapshot = snapshotAiWorld(data, "2026-09-05T10:37:15.000Z");
  assert.equal(snapshot.clockAt, "2026-09-05T10:37:15.000Z");
  assert.equal(snapshot.state.updatedAt, createdAt);
});

test("OH-P3: advancing inside the same deterministic phase is idempotent", () => {
  const data = createAiWorldData("2026-09-05T10:00:00.000Z", "UTC");
  const advanced = advanceAiWorldData(data, "2026-09-05T11:59:59.000Z");
  assert.equal(advanced.changed, false);
  assert.deepEqual(advanced.data, data);
});

test("OH-P3: crossing a daypart creates one traceable transition without a model", () => {
  const data = createAiWorldData("2026-09-05T11:59:00.000Z", "UTC");
  const advanced = advanceAiWorldData(data, "2026-09-05T12:00:00.000Z");
  assert.equal(advanced.changed, true);
  assert.equal(advanced.data.state.phaseKey, "2026-09-05:midday_break");
  assert.equal(advanced.data.state.room, "kitchen");
  assert.equal(advanced.data.state.workState, "off_duty");
  assert.equal(advanced.data.state.currentActivity, "midday_break");
  assert.equal(advanced.data.history.length, 2);
  const event = advanced.data.history[0]!;
  assert.equal(event.kind, "state_transition");
  assert.deepEqual([event.world, event.provenance], ["AI_WORLD", "simulated"]);
  assert.equal(event.fromPhaseKey, "2026-09-05:focused_work");
  assert.equal(event.toPhaseKey, "2026-09-05:midday_break");
});

test("OH-12/OH-P3: the same instant can produce a different phase only through the configured AI World timezone", () => {
  const instant = "2026-09-05T00:30:00.000Z";
  const utc = createAiWorldData(instant, "UTC");
  const taipei = createAiWorldData(instant, "Asia/Taipei");
  assert.equal(utc.state.currentActivity, "sleeping");
  assert.equal(taipei.state.currentActivity, "morning_routine");
  assert.equal(utc.state.updatedAt, taipei.state.updatedAt);
});

test("OH-11/OH-P3: crossing a local date creates a new phase key and bounded virtual weather state", () => {
  const data = createAiWorldData("2026-09-05T23:59:00.000Z", "UTC");
  const advanced = advanceAiWorldData(data, "2026-09-06T00:01:00.000Z");
  assert.equal(advanced.changed, true);
  assert.match(advanced.data.state.phaseKey, /^2026-09-06:/);
  assert.ok(["clear", "cloudy", "rain"].includes(advanced.data.state.weather));
});

test("OH-30/OH-32: corrupted AI World boundaries fail closed", () => {
  const data = createAiWorldData("2026-09-05T10:00:00.000Z", "UTC");
  const corrupted = structuredClone(data) as typeof data & { state: { world: string } };
  corrupted.state.world = "EARTH";
  assert.throws(() => assertValidAiWorldData(corrupted as never), /invalid world boundary/);
});

test("OH-P3: backward or repeated clocks never rewind canonical state", () => {
  const data = createAiWorldData("2026-09-05T18:00:00.000Z", "UTC");
  assert.equal(advanceAiWorldData(data, "2026-09-05T18:00:00.000Z").changed, false);
  assert.equal(advanceAiWorldData(data, "2026-09-05T17:00:00.000Z").changed, false);
});
