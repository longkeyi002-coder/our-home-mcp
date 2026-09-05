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
    [["ambiguous", "EARTH", "legacy_unclassified"], ["obs", "EARTH", "observed"]],
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
