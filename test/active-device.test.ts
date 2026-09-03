import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonStore } from "../src/store.js";

test("active phone device alone drives current life state and FCM target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-active-device-"));
  const store = await JsonStore.open(join(directory, "data.json"), false);
  await store.registerPhoneDevice({ deviceId: "old", pushToken: "old-token" });
  await store.registerPhoneDevice({ deviceId: "active", pushToken: "active-token" });
  await store.recordObservation({ kind: "device_presence", label: "old", value: "screen_on", observedAt: "2026-09-03T11:59:00.000Z", source: "phone", confidence: "observed", deviceId: "old", metadata: { connectivityState: "online" } });
  await store.recordObservation({ kind: "screen_app", label: "active", value: "com.example.active", observedAt: "2026-09-03T11:59:30.000Z", source: "phone", confidence: "observed", deviceId: "active" });
  const context = store.getLifeContext("2026-09-03T12:00:00.000Z");
  assert.equal(context.activePhoneDeviceId, "active");
  assert.equal(context.lifeState.foregroundPackage, "com.example.active");
  assert.equal(store.getPrimaryPushDevice()?.pushToken, "active-token");
  assert.equal(store.snapshot().phoneDeviceRegistrations.find((item) => item.deviceId === "old")?.active, false);
});
