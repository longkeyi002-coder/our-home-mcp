import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { JsonStore } from "../src/store.js";

test("phone heartbeat writes its presence and foreground observation atomically and idempotently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-heartbeat-"));
  const filePath = join(directory, "our-home.json");
  const store = await JsonStore.open(filePath, false);
  const input = {
    deviceId: "android-test",
    status: "online",
    observedAt: "2026-09-02T00:00:00Z",
    foregroundPackage: "com.example.app",
    clientEventId: "heartbeat-1",
    metadata: { clientEventId: "heartbeat-1", batteryPercent: 82 },
  };

  const [first, retry] = await Promise.all([
    store.recordPhoneHeartbeat(input),
    store.recordPhoneHeartbeat(input),
  ]);

  assert.equal([first, retry].filter((result) => result.created).length, 1);
  assert.equal(first.observation.id, retry.observation.id);
  assert.equal(first.foregroundObservation?.id, retry.foregroundObservation?.id);
  assert.equal(store.snapshot().observations.length, 2);

  const reopened = await JsonStore.open(filePath, false);
  const afterRestart = await reopened.recordPhoneHeartbeat(input);
  assert.equal(afterRestart.created, false);
  assert.equal(afterRestart.observation.id, first.observation.id);
  assert.equal(afterRestart.foregroundObservation?.id, first.foregroundObservation?.id);
  assert.equal(reopened.snapshot().observations.length, 2);
});
