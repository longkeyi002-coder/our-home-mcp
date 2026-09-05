import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOurHomeServer } from "../src/server.js";
import { JsonStore } from "../src/store.js";
import { deriveContextUnderstanding } from "../src/context-understanding.js";
import { decideVisualBudget } from "../src/visual-budget.js";
import { deriveVisualRequest } from "../src/visual-request.js";
import { derivePhoneTelemetryStatus } from "../src/phone-status.js";
import type { LifeObservation } from "../src/types.js";

const at = "2026-09-05T12:00:00.000Z";
const fake: LifeObservation = {
  id: "virtual", kind: "visual_observation_summary", label: "virtual game",
  world: "AI_WORLD", provenance: "simulated", confidence: "observed", source: "phone",
  observedAt: at, deviceId: "not-a-phone",
  metadata: { sessionId: "session", activity: "gaming", confidence: 1 },
};

test("virtual observations cannot change understanding, budget, capture requests or phone liveness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-world-consumers-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  for (const world of ["AI_WORLD", "FICTION"] as const) {
    const visual = { ...fake, world };
    const declaration = { ...visual, kind: "manual_status" as const, source: "user" as const, confidence: "declared" as const };
    assert.equal(deriveContextUnderstanding([visual, declaration], fake.deviceId, "session", Date.parse(at)).understanding, "UNKNOWN");
    const audit = { ...visual, kind: "visual_policy_audit" as const, metadata: { action: "capture_succeeded", allowed: true } };
    assert.equal(decideVisualBudget([audit, audit, audit], fake.deviceId, Date.parse(at)).usedInHour, 0);
    assert.equal(deriveVisualRequest({ ...visual, kind: "presence_app_dwell" }, []), null);
    const data = store.snapshot();
    data.observations = [visual];
    assert.deepEqual(derivePhoneTelemetryStatus(data), []);
  }
});

test("MCP rejects illegal boundaries and keeps fiction out of Earth context", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-world-mcp-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  const server = createOurHomeServer(store);
  const client = new Client({ name: "world-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  t.after(async () => { await client.close(); await server.close(); });
  const input = { kind: "note", label: "story", observedAt: at, source: "system", confidence: "observed" };
  const invalid = await client.callTool({ name: "home.record_observation", arguments: { ...input, world: "AI_WORLD", provenance: "observed" } });
  assert.equal(invalid.isError, true);
  const valid = await client.callTool({ name: "home.record_observation", arguments: { ...input, world: "FICTION", provenance: "authored", evidenceRefs: ["story:1"] } });
  assert.notEqual(valid.isError, true);
  assert.deepEqual(store.snapshot().observations[0]?.evidenceRefs, ["story:1"]);
  const result = await client.callTool({ name: "home.get_life_context", arguments: {} });
  assert.deepEqual((result.structuredContent as { observations: unknown[] }).observations, []);
});
