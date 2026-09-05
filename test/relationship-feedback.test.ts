import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import { listAiWorldPreferenceStates } from "../src/ai-world-preference.js";
import { readAiWorldContinuity } from "../src/ai-world-continuity.js";
import {
  captureRelationshipFeedback,
  listRelationshipFeedback,
  recordRelationshipFeedback,
} from "../src/relationship-feedback.js";
import { JsonStore } from "../src/store.js";
import { listUserFeedback } from "../src/user-feedback.js";

const WORLD_AT = "2026-09-05T09:00:00.000Z";
const DELIVERED_AT = "2026-09-05T10:00:00.000Z";
const SIGNAL_AT = "2026-09-05T10:05:00.000Z";

async function initializedStore(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const path = join(directory, "data.json");
  const store = await JsonStore.open(path, false);
  await advancePersistedAiWorld(store, WORLD_AT, "UTC");
  await store.update((data) => {
    data.proactiveQueue.unshift({
      id: "message-1",
      title: "A delivered message",
      message: "Something worth reacting to",
      reason: "test basis",
      dueAt: DELIVERED_AT,
      status: "delivered",
      createdAt: WORLD_AT,
      deliveredAt: DELIVERED_AT,
      attempts: 1,
      source: "AGENT_LIFE",
    });
  });
  return { store, path };
}

test("OH-P6: like is explicit Earth feedback and routes through the bounded P4.5 proactive-message preference", async () => {
  const { store } = await initializedStore("our-home-relationship-like-");
  const queueBefore = structuredClone(store.snapshot().proactiveQueue);
  const observationsBefore = structuredClone(store.snapshot().observations);
  const soulBefore = readAiWorldContinuity(store).soulTendencies ?? [];

  const result = await captureRelationshipFeedback(store, {
    signalKey: "ui:like:message-1",
    proactiveCandidateId: "message-1",
    signal: "like",
    occurredAt: SIGNAL_AT,
  }, SIGNAL_AT);

  assert.equal(result.preferenceApplied, true);
  assert.equal(result.record.world, "EARTH");
  assert.equal(result.record.provenance, "user_declared");
  assert.ok(result.record.derivedUserFeedbackId);
  assert.equal(result.userFeedback?.feedback.interestKey, "relationship:proactive_messages");
  assert.equal(result.userFeedback?.feedback.signal, "positive_reaction");
  const preference = listAiWorldPreferenceStates(store).find((item) => item.interestKey === "relationship:proactive_messages");
  assert.ok(preference);
  assert.equal(preference.score, 0.0125);
  assert.deepEqual(store.snapshot().proactiveQueue, queueBefore);
  assert.deepEqual(store.snapshot().observations, observationsBefore);
  assert.deepEqual(readAiWorldContinuity(store).soulTendencies ?? [], soulBefore);
});

test("OH-P6: accept/reject suggestions use fixed strategy keys and caller cannot choose strength or interest", async () => {
  const { store } = await initializedStore("our-home-relationship-suggestion-");
  const accepted = await captureRelationshipFeedback(store, {
    signalKey: "ui:accept:message-1",
    proactiveCandidateId: "message-1",
    signal: "accept_suggestion",
    occurredAt: SIGNAL_AT,
  }, SIGNAL_AT);
  assert.equal(accepted.userFeedback?.feedback.interestKey, "relationship:suggestions");
  assert.equal(accepted.userFeedback?.feedback.signal, "prefer_more");
  assert.equal(listAiWorldPreferenceStates(store).find((item) => item.interestKey === "relationship:suggestions")?.score, 0.025);

  await assert.rejects(captureRelationshipFeedback(store, {
    signalKey: "ui:malformed:message-1",
    proactiveCandidateId: "message-1",
    signal: "like",
    occurredAt: SIGNAL_AT,
    interestKey: "caller:chosen",
    strength: 1,
    soulDelta: 1,
  }, SIGNAL_AT), /strict input contract/);
});

test("OH-P6: reply and ignore remain observed relationship signals and do not imply Preference valence", async () => {
  for (const signal of ["reply", "ignore"] as const) {
    const { store } = await initializedStore(`our-home-relationship-${signal}-`);
    const beforePreferences = listAiWorldPreferenceStates(store);
    const result = await captureRelationshipFeedback(store, {
      signalKey: `ui:${signal}:message-1`,
      proactiveCandidateId: "message-1",
      signal,
      occurredAt: SIGNAL_AT,
    }, SIGNAL_AT);

    assert.equal(result.preferenceApplied, false);
    assert.equal(result.record.provenance, "observed");
    assert.equal(result.record.derivedUserFeedbackId, undefined);
    assert.deepEqual(listAiWorldPreferenceStates(store), beforePreferences);
    assert.equal(listUserFeedback(store).length, 0);
  }
});

test("OH-40/OH-P6: stable signal replay is idempotent and conflicting signalKey reuse fails closed", async () => {
  const { store } = await initializedStore("our-home-relationship-dedupe-");
  const input = {
    signalKey: "ui:like:stable",
    proactiveCandidateId: "message-1",
    signal: "like" as const,
    occurredAt: SIGNAL_AT,
  };
  const first = await captureRelationshipFeedback(store, input, SIGNAL_AT);
  const second = await captureRelationshipFeedback(store, input, SIGNAL_AT);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.record.id, second.record.id);
  assert.equal(listRelationshipFeedback(store).length, 1);
  assert.equal(listUserFeedback(store).length, 1);
  assert.equal(listAiWorldPreferenceStates(store)[0]?.evidenceCount, 1);

  await assert.rejects(recordRelationshipFeedback(store, {
    ...input,
    signal: "dislike",
  }, SIGNAL_AT), /signalKey collision/);
});

test("OH-47/OH-P6: feedback requires a real delivered subject and cannot predate delivery", async () => {
  const { store } = await initializedStore("our-home-relationship-subject-");
  await assert.rejects(recordRelationshipFeedback(store, {
    signalKey: "ui:missing",
    proactiveCandidateId: "missing",
    signal: "like",
    occurredAt: SIGNAL_AT,
  }, SIGNAL_AT), /existing delivered proactive message/);

  await assert.rejects(recordRelationshipFeedback(store, {
    signalKey: "ui:early",
    proactiveCandidateId: "message-1",
    signal: "like",
    occurredAt: "2026-09-05T09:59:59.000Z",
  }, SIGNAL_AT), /cannot precede proactive-message delivery/);

  await store.update((data) => {
    data.proactiveQueue.unshift({
      id: "pending-message",
      title: "Pending",
      message: "Not delivered yet",
      reason: "test",
      dueAt: SIGNAL_AT,
      status: "pending",
      createdAt: WORLD_AT,
      attempts: 0,
      source: "AGENT_LIFE",
    });
  });
  await assert.rejects(recordRelationshipFeedback(store, {
    signalKey: "ui:pending",
    proactiveCandidateId: "pending-message",
    signal: "like",
    occurredAt: SIGNAL_AT,
  }, SIGNAL_AT), /existing delivered proactive message/);
});

test("OH-67/OH-P6: relationship-signal records and P4.5 dedupe survive restart", async () => {
  const { store, path } = await initializedStore("our-home-relationship-restart-");
  const input = {
    signalKey: "ui:restart:message-1",
    proactiveCandidateId: "message-1",
    signal: "dislike" as const,
    occurredAt: SIGNAL_AT,
  };
  const first = await captureRelationshipFeedback(store, input, SIGNAL_AT);
  const reopened = await JsonStore.open(path, false);
  const second = await captureRelationshipFeedback(reopened, input, SIGNAL_AT);
  assert.equal(second.duplicate, true);
  assert.equal(second.record.id, first.record.id);
  assert.equal(listRelationshipFeedback(reopened).length, 1);
  assert.equal(listUserFeedback(reopened).length, 1);
  assert.equal(listAiWorldPreferenceStates(reopened)[0]?.evidenceCount, 1);
});
