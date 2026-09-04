import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derivePhoneTelemetryStatus } from "../src/phone-status.js";
import { JsonStore } from "../src/store.js";

test("OH-31 phone status is derived from observed phone telemetry without exposing credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-phone-status-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  await store.registerPhoneDevice({
    deviceId: "android-a",
    appVersion: "0.1.0",
    pushToken: "must-not-leak",
  });
  await store.recordObservation({
    kind: "device_presence",
    label: "手机在线",
    value: "online",
    observedAt: "2026-09-04T07:00:00.000Z",
    source: "phone",
    confidence: "observed",
    deviceId: "android-a",
    metadata: { clientEventId: "heartbeat-1" },
  });
  await store.recordObservation({
    kind: "usage_summary",
    label: "app usage timeline",
    observedAt: "2026-09-04T07:05:00.000Z",
    source: "phone",
    confidence: "observed",
    deviceId: "android-a",
    metadata: { clientEventId: "usage-1" },
  });

  const status = derivePhoneTelemetryStatus(store.snapshot());
  assert.equal(status.length, 1);
  assert.deepEqual(status[0], {
    deviceId: "android-a",
    registeredAt: store.snapshot().phoneDeviceRegistrations[0]?.updatedAt ?? null,
    appVersion: "0.1.0",
    hasPushAddress: true,
    lastSeenAt: "2026-09-04T07:05:00.000Z",
    lastHeartbeatAt: "2026-09-04T07:00:00.000Z",
    lastObservationAt: "2026-09-04T07:05:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(status), /must-not-leak/);
});

test("OH-32 phone status ignores non-phone records when deriving device liveness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-phone-status-source-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  await store.registerPhoneDevice({ deviceId: "android-a", appVersion: "0.1.0" });
  await store.recordObservation({
    kind: "note",
    label: "inference",
    observedAt: "2026-09-04T08:00:00.000Z",
    source: "system",
    confidence: "inferred",
    deviceId: "android-a",
  });

  const [status] = derivePhoneTelemetryStatus(store.snapshot());
  assert.equal(status?.lastSeenAt, null);
  assert.equal(status?.lastHeartbeatAt, null);
});
