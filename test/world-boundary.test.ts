import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import { deriveLifeState } from "../src/life-state.js";
import { isEarthEvidence, isValidWorldProvenance } from "../src/world-boundary.js";
import type { LifeObservation } from "../src/types.js";

const base = {
  id: "obs",
  kind: "screen_app" as const,
  label: "foreground",
  value: "com.example.app",
  observedAt: "2026-09-05T12:00:00.000Z",
  source: "phone" as const,
  confidence: "observed" as const,
};

test("world/provenance accepts canonical combinations and rejects cross-world observed facts", () => {
  assert.equal(isValidWorldProvenance("EARTH", "observed"), true);
  assert.equal(isValidWorldProvenance("EARTH", "user_declared"), true);
  assert.equal(isValidWorldProvenance("AI_WORLD", "simulated"), true);
  assert.equal(isValidWorldProvenance("FICTION", "authored"), true);
  assert.equal(isValidWorldProvenance("AI_WORLD", "observed"), false);
  assert.equal(isValidWorldProvenance("FICTION", "user_declared"), false);
});

test("Earth Life State ignores AI World and Fiction evidence", () => {
  const aiWorld = { ...base, id: "ai", world: "AI_WORLD" as const, provenance: "simulated" as const };
  const fiction = { ...base, id: "fiction", world: "FICTION" as const, provenance: "authored" as const };
  assert.equal(isEarthEvidence(aiWorld), false);
  assert.equal(isEarthEvidence(fiction), false);
  const state = deriveLifeState([aiWorld, fiction] as LifeObservation[], base.observedAt);
  assert.notEqual(state.currentActivity, "active_on_phone");
  assert.equal(state.foregroundPackage, null);
});

test("v2 observations migrate deterministically without upgrading ambiguous records to Earth evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-world-"));
  const filePath = join(directory, "our-home.json");
  await writeFile(filePath, JSON.stringify({
    schemaVersion: 2,
    diaries: [], relationshipEvents: [], actions: [], activities: [], proactiveMessages: [],
    homeState: { presence: "unknown", updatedAt: base.observedAt, source: "HOME_STATE" },
    observations: [
      base,
      { ...base, id: "ambiguous", source: "system", confidence: "declared" },
    ],
    routines: [], heartbeats: [], proactiveQueue: [],
  }), "utf8");
  const store = await JsonStore.open(filePath, false);
  const observations = store.snapshot().observations;
  assert.deepEqual(
    observations.map((item) => [item.id, item.world, item.provenance]),
    [["obs", "EARTH", "observed"], ["ambiguous", "EARTH", "legacy_unclassified"]],
  );
  assert.equal(store.snapshot().schemaVersion, 3);
});

test("new observations reject illegal world/provenance pairs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-world-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  await assert.rejects(
    store.recordObservation({ ...base, world: "AI_WORLD", provenance: "observed" }),
    /Illegal world\/provenance combination/,
  );
});


test("unknown persisted world, partial boundaries and contradictory claims fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-invalid-world-"));
  const path = join(dir, "data.json");
  const store = await JsonStore.open(path, false);
  for (const boundary of [
    { world: "INVALID", provenance: "inferred" },
    { world: "EARTH" },
    { world: "EARTH", provenance: "simulated" },
    { world: "EARTH", provenance: "user_declared" },
  ]) {
    await assert.rejects(store.recordObservation({ ...base, ...boundary } as Parameters<JsonStore["recordObservation"]>[0]));
  }
  const snapshot = store.snapshot();
  snapshot.observations = [{ ...base } as LifeObservation];
  await writeFile(path, JSON.stringify(snapshot));
  await assert.rejects(JsonStore.open(path, false), /require world and provenance/);
});

test("worlds cannot collide in idempotency, compaction or bounded Brain context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-world-dedupe-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  const observedAt = new Date().toISOString();
  const input = { ...base, kind: "usage_summary" as const, observedAt, deviceId: "phone", clientEventId: "same-event" };
  const earth = await store.recordObservation({ ...input, world: "EARTH", provenance: "observed" });
  const fiction = await store.recordObservation({ ...input, world: "FICTION", provenance: "authored" });
  assert.notEqual(earth.id, fiction.id);
  assert.equal(store.snapshot().observations.length, 2);
  assert.equal((await store.recordObservation({ ...input, world: "EARTH", provenance: "observed" })).id, earth.id);
  for (let i = 0; i < 55; i++) {
    await store.recordObservation({ ...base, observedAt, world: "AI_WORLD", provenance: "simulated" });
  }
  const context = store.getLifeContext(observedAt);
  assert.deepEqual(context.observations.map((item) => item.id), [earth.id]);
});

test("ambiguous system legacy events are quarantined and old wake decisions cannot escape migration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-world-migration-"));
  const path = join(dir, "data.json");
  const store = await JsonStore.open(path, false);
  const snapshot = store.snapshot();
  const legacy = {
    ...snapshot, schemaVersion: 2,
    observations: [{ ...base, source: "system", confidence: "observed" }],
    wakeEvents: [{ id: "old-wake", status: "pending" }],
    proactiveQueue: [{ id: "old-message", wakeEventId: "old-wake", status: "pending" }],
  };
  await writeFile(path, JSON.stringify(legacy));
  const reopened = await JsonStore.open(path, false);
  assert.equal(reopened.snapshot().observations[0]?.provenance, "legacy_unclassified");
  assert.equal(reopened.snapshot().wakeEvents[0]?.status, "dismissed");
  assert.equal(reopened.snapshot().proactiveQueue[0]?.status, "dismissed");
  assert.equal(reopened.snapshot().wakeEngineState.lastLifeState, null);
  await reopened.recordHeartbeat("persist migrated schema");
  assert.deepEqual((await JsonStore.open(path, false)).snapshot(), JSON.parse(JSON.stringify(reopened.snapshot())));
});
