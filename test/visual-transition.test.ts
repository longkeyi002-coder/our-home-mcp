import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveVisualOpportunity, VISUAL_TRANSITION_REASON } from "../src/visual-request.js";
import { JsonStore } from "../src/store.js";
import { claimPendingWakeEvents } from "../src/worker-claims.js";
import type { LifeObservation } from "../src/types.js";

function transition(
  observedAt: string,
  options: {
    packageName?: string;
    screenInteractive?: boolean;
    unlocked?: boolean;
    identityHidden?: boolean;
    includeDirectScreenEvidence?: boolean;
  } = {},
): LifeObservation {
  const packageName = options.packageName ?? "com.example.game";
  const metadata: Record<string, string | number | boolean> = {
    fromPackage: "com.example.home",
    toPackage: options.identityHidden ? "private_app_active" : packageName,
    identityHidden: String(options.identityHidden ?? false),
    startedAt: observedAt,
    lastInteractionAt: observedAt,
  };
  if (options.includeDirectScreenEvidence !== false) {
    metadata.screenInteractive = String(options.screenInteractive ?? true);
    metadata.unlocked = String(options.unlocked ?? true);
  }
  return {
    id: `transition-${observedAt}-${packageName}`,
    kind: "presence_app_transition",
    world: "EARTH",
    provenance: "observed",
    label: options.identityHidden ? "private_app_active" : packageName,
    value: options.identityHidden ? "private_app_active" : packageName,
    observedAt,
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata,
  };
}

function screen(observedAt: string, interactive: boolean, unlocked: boolean): LifeObservation {
  return {
    id: `screen-${observedAt}`,
    kind: "presence_screen",
    world: "EARTH",
    provenance: "observed",
    label: interactive ? "screen_on" : "screen_off",
    value: interactive ? "on" : "off",
    observedAt,
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata: { interactive: String(interactive), unlocked: String(unlocked) },
  };
}

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "our-home-visual-transition-"));
  return JsonStore.open(join(dir, "data.json"), false);
}

test("active app transition immediately creates a Brain visual opportunity", () => {
  const item = transition("2026-09-06T01:00:00.000Z");
  const opportunity = deriveVisualOpportunity(item, [item]);
  assert.ok(opportunity);
  assert.equal(opportunity.packageName, "com.example.game");
  assert.equal(opportunity.sessionId, `com.example.game:${Date.parse(item.observedAt)}`);
  assert.equal(opportunity.curiosityReason, VISUAL_TRANSITION_REASON);
});

test("locked, screen-off, or identity-hidden transition fails closed", () => {
  const at = "2026-09-06T01:00:00.000Z";
  assert.equal(deriveVisualOpportunity(transition(at, { screenInteractive: false }), []), null);
  assert.equal(deriveVisualOpportunity(transition(at, { unlocked: false }), []), null);
  assert.equal(deriveVisualOpportunity(transition(at, { identityHidden: true }), []), null);
});

test("older clients may use the latest explicit screen-state evidence", () => {
  const screenAt = "2026-09-06T00:59:59.000Z";
  const at = "2026-09-06T01:00:00.000Z";
  const screenState = screen(screenAt, true, true);
  const item = transition(at, { includeDirectScreenEvidence: false });
  assert.ok(deriveVisualOpportunity(item, [screenState, item]));

  const lockedState = screen(screenAt, true, false);
  assert.equal(deriveVisualOpportunity(item, [lockedState, item]), null);
});

test("only the newest pending visual session for one device reaches Brain", async () => {
  const store = await createStore();
  const first = await store.enqueueVisualOpportunity({
    deviceId: "android-1",
    packageName: "com.example.first",
    sessionId: `com.example.first:${Date.parse("2026-09-06T01:00:00.000Z")}`,
    curiosityReason: VISUAL_TRANSITION_REASON,
    observedAt: "2026-09-06T01:00:00.000Z",
    expiresAt: "2026-09-06T01:05:00.000Z",
  });
  const second = await store.enqueueVisualOpportunity({
    deviceId: "android-1",
    packageName: "com.example.second",
    sessionId: `com.example.second:${Date.parse("2026-09-06T01:00:30.000Z")}`,
    curiosityReason: VISUAL_TRANSITION_REASON,
    observedAt: "2026-09-06T01:00:30.000Z",
    expiresAt: "2026-09-06T01:05:30.000Z",
  });

  const claimed = await claimPendingWakeEvents(store, "2026-09-06T01:01:00.000Z", 5);
  assert.deepEqual(claimed.map((item) => item.id), [second.id]);
  const snapshot = store.snapshot();
  assert.equal(snapshot.wakeEvents.find((item) => item.id === first.id)?.status, "dismissed");
  assert.equal(snapshot.wakeEvents.find((item) => item.id === second.id)?.status, "pending");
});
