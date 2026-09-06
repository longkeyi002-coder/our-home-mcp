import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import { runProactiveCycle } from "../src/worker.js";
import type { BrainAdapter } from "../src/brain.js";
import type { WakeDecision } from "../src/types.js";
import type { VisualOpportunity } from "../src/visual-request.js";

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-brain-visual-"));
  return JsonStore.open(join(dir, "data.json"), false);
}

function opportunity(overrides: Partial<VisualOpportunity> = {}): VisualOpportunity {
  return {
    deviceId: "android-1",
    packageName: "com.example.game",
    sessionId: `com.example.game:${Date.parse("2026-09-05T12:00:00.000Z")}`,
    curiosityReason: "unknown_dwell",
    observedAt: "2026-09-05T12:10:00.000Z",
    expiresAt: "2026-09-05T12:15:00.000Z",
    ...overrides,
  };
}

function brain(decision: WakeDecision, calls: string[]): BrainAdapter {
  return {
    async evaluate(input) {
      calls.push(input.wakeEvent.id);
      return decision;
    },
  };
}

const notifier = { deliver: async () => {} };

test("Brain approval creates one short-lived request bound to the exact eligible device/App/session", async () => {
  const store = await createStore();
  const visualOpportunity = opportunity();
  const wake = await store.enqueueVisualOpportunity(visualOpportunity);
  const calls: string[] = [];

  await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-05T12:11:00.000Z"),
    brain({ action: "request_visual", reason: "A single glance would resolve the unknown activity" }, calls),
  );

  assert.deepEqual(calls, [wake.id]);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === wake.id)?.status, "handled");
  const requests = store.snapshot().visualRequests ?? [];
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.equal(request.deviceId, visualOpportunity.deviceId);
  assert.equal(request.packageName, visualOpportunity.packageName);
  assert.equal(request.sessionId, visualOpportunity.sessionId);
  assert.equal(request.reason, "A single glance would resolve the unknown activity");
  assert.equal(request.status, "pending");
  assert.equal(request.issuedAt, "2026-09-05T12:11:00.000Z");
  assert.equal(request.expiresAt, "2026-09-05T12:13:00.000Z");
  assert.equal(store.getPendingVisualRequest("android-1", "2026-09-05T12:12:00.000Z")?.requestId, request.requestId);
});

test("Brain ignore handles the opportunity without creating a visual request", async () => {
  const store = await createStore();
  const wake = await store.enqueueVisualOpportunity(opportunity());
  const calls: string[] = [];

  await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-05T12:11:00.000Z"),
    brain({ action: "ignore" }, calls),
  );

  assert.deepEqual(calls, [wake.id]);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === wake.id)?.status, "handled");
  assert.equal((store.snapshot().visualRequests ?? []).length, 0);
});

test("expired visual opportunity fails closed without calling Brain", async () => {
  const store = await createStore();
  const wake = await store.enqueueVisualOpportunity(opportunity({ expiresAt: "2026-09-05T12:10:30.000Z" }));
  const calls: string[] = [];

  await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-05T12:11:00.000Z"),
    brain({ action: "request_visual", reason: "too late" }, calls),
  );

  assert.equal(calls.length, 0);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === wake.id)?.status, "dismissed");
  assert.equal((store.snapshot().visualRequests ?? []).length, 0);
});

test("an expired pending visual opportunity does not block a fresh one for the same session", async () => {
  const store = await createStore();
  const first = await store.enqueueVisualOpportunity(opportunity({ expiresAt: "2026-09-05T12:10:30.000Z" }));
  const second = await store.enqueueVisualOpportunity(opportunity({
    observedAt: "2026-09-05T12:11:00.000Z",
    expiresAt: "2026-09-05T12:16:00.000Z",
  }));

  assert.notEqual(second.id, first.id);
  const snapshot = store.snapshot();
  assert.equal(snapshot.wakeEvents.find((item) => item.id === first.id)?.status, "dismissed");
  assert.equal(snapshot.wakeEvents.find((item) => item.id === second.id)?.status, "pending");
  assert.equal(store.hasPendingVisualDecision("android-1", "2026-09-05T12:11:30.000Z"), true);
});

test("an unexpired pending visual opportunity still coalesces for the same session", async () => {
  const store = await createStore();
  const first = await store.enqueueVisualOpportunity(opportunity());
  const second = await store.enqueueVisualOpportunity(opportunity({
    observedAt: "2026-09-05T12:11:00.000Z",
    expiresAt: "2026-09-05T12:16:00.000Z",
  }));

  assert.equal(second.id, first.id);
  assert.equal(store.snapshot().wakeEvents.filter((item) => item.type === "visual_opportunity").length, 1);
});

test("a visual summary consumes the matching Brain-approved request", async () => {
  const store = await createStore();
  const visualOpportunity = opportunity();
  await store.enqueueVisualOpportunity(visualOpportunity);
  await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-05T12:11:00.000Z"),
    brain({ action: "request_visual", reason: "resolve context" }, []),
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
    deviceId: "android-1",
    metadata: {
      packageName: visualOpportunity.packageName,
      activity: "gaming",
      confidence: 0.9,
      provider: "test",
      model: "test-vision",
      requestId: request.requestId,
      sessionId: visualOpportunity.sessionId,
    },
  });

  const consumed = (store.snapshot().visualRequests ?? []).find((item) => item.requestId === request.requestId)!;
  assert.equal(consumed.status, "observed");
  assert.equal(consumed.observedAt, "2026-09-05T12:11:20.000Z");
  assert.equal(store.getPendingVisualRequest("android-1", "2026-09-05T12:11:30.000Z"), undefined);
});