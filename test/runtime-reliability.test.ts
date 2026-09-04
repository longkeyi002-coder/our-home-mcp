import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import { startProactiveLoop } from "../src/worker.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("proactive loop never overlaps a slow delivery cycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "our-home-loop-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  await store.scheduleProactiveMessage({
    title: "slow",
    message: "slow",
    reason: "test serialized loop",
    dueAt: "2026-09-04T00:00:00.000Z",
  });

  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let deliveries = 0;
  const handle = startProactiveLoop(store, {
    intervalMs: 20,
    now: () => new Date("2026-09-04T00:01:00.000Z"),
    log: () => {},
    notifier: {
      deliver: async () => {
        deliveries += 1;
        await blocked;
      },
    },
  });

  await delay(60);
  assert.equal(deliveries, 1);
  assert.equal(store.snapshot().heartbeats.length, 1, "no second cycle starts while delivery is blocked");

  release();
  await delay(70);
  handle.stop();
  assert.ok(store.snapshot().heartbeats.length >= 2, "the next cycle runs after the previous cycle settles");
  assert.equal(deliveries, 1, "the delivered candidate is not sent twice");
});
