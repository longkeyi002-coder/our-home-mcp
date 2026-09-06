import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import {
  decideQuietHours,
  quietHoursPolicyFromEnv,
  type QuietHoursPolicy,
} from "../src/quiet-hours.js";
import { runProactiveCycle } from "../src/worker.js";

const overnight: QuietHoursPolicy = {
  enabled: true,
  startLocal: "22:00",
  endLocal: "07:00",
  timezone: "UTC",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  allowHighPriority: true,
};

test("OH-40/OH-47: quiet hours are disabled unless the full runtime configuration is present", () => {
  assert.equal(quietHoursPolicyFromEnv({}).enabled, false);
  assert.throws(
    () => quietHoursPolicyFromEnv({ OUR_HOME_QUIET_HOURS_START: "22:00" }),
    /require OUR_HOME_QUIET_HOURS_START, OUR_HOME_QUIET_HOURS_END, and OUR_HOME_QUIET_HOURS_TIMEZONE together/,
  );
  assert.throws(
    () => quietHoursPolicyFromEnv({
      OUR_HOME_QUIET_HOURS_START: "22:00",
      OUR_HOME_QUIET_HOURS_END: "22:00",
      OUR_HOME_QUIET_HOURS_TIMEZONE: "UTC",
    }),
    /start and end must differ/,
  );
});

test("OH-40/OH-47: overnight quiet hours defer until the exact local end minute", () => {
  const decision = decideQuietHours(overnight, "2026-09-07T23:30:37.000Z", "normal");
  assert.deepEqual(decision, {
    defer: true,
    reason: "quiet_hours",
    nextAvailableAt: "2026-09-08T07:00:00.000Z",
  });
  assert.deepEqual(
    decideQuietHours(overnight, "2026-09-08T07:00:00.000Z", "normal"),
    { defer: false, reason: "outside_quiet_hours" },
  );
});

test("OH-40/OH-47: weekday selection treats the after-midnight portion as the previous day", () => {
  const mondayOnly: QuietHoursPolicy = { ...overnight, weekdays: [1] };
  assert.equal(decideQuietHours(mondayOnly, "2026-09-07T23:00:00.000Z").defer, true);
  assert.equal(decideQuietHours(mondayOnly, "2026-09-08T02:00:00.000Z").defer, true);
  assert.equal(decideQuietHours(mondayOnly, "2026-09-09T02:00:00.000Z").defer, false);
});

test("OH-47: high-priority wake bypass is explicit and can be disabled", () => {
  assert.deepEqual(
    decideQuietHours(overnight, "2026-09-07T23:00:00.000Z", "high"),
    { defer: false, reason: "high_priority_bypass" },
  );
  const strict = { ...overnight, allowHighPriority: false };
  assert.equal(decideQuietHours(strict, "2026-09-07T23:00:00.000Z", "high").defer, true);
});

test("OH-P2: worker persists why a message was deferred and delivers it after quiet hours", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-quiet-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);
  const candidate = await store.scheduleProactiveMessage({
    title: "晚安后再说",
    message: "这条消息应该等静默时间结束。",
    reason: "quiet-hours test",
    dueAt: "2026-09-07T23:00:00.000Z",
  });
  const delivered: string[] = [];
  const notifier = { deliver: async () => { delivered.push("sent"); } };

  const quietCycle = await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-07T23:00:00.000Z"),
    undefined,
    overnight,
  );
  assert.equal(quietCycle.dueCount, 1);
  assert.equal(quietCycle.deliveredCount, 0);
  assert.equal(delivered.length, 0);
  const deferred = store.snapshot().proactiveQueue.find((item) => item.id === candidate.id)!;
  assert.equal(deferred.status, "pending");
  assert.equal(deferred.dueAt, "2026-09-08T07:00:00.000Z");
  assert.equal(deferred.processingAt, undefined);
  assert.deepEqual(deferred.lastDeliveryPolicy, {
    evaluatedAt: "2026-09-07T23:00:00.000Z",
    outcome: "deferred",
    reason: "quiet_hours",
    nextAvailableAt: "2026-09-08T07:00:00.000Z",
  });

  const beforeEnd = await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-08T06:59:00.000Z"),
    undefined,
    overnight,
  );
  assert.equal(beforeEnd.dueCount, 0);
  assert.equal(delivered.length, 0);

  const afterEnd = await runProactiveCycle(
    store,
    notifier,
    new Date("2026-09-08T07:00:00.000Z"),
    undefined,
    overnight,
  );
  assert.equal(afterEnd.dueCount, 1);
  assert.equal(afterEnd.deliveredCount, 1);
  assert.equal(delivered.length, 1);
  const deliveredCandidate = store.snapshot().proactiveQueue.find((item) => item.id === candidate.id)!;
  assert.equal(deliveredCandidate.status, "delivered");
  assert.equal(deliveredCandidate.lastDeliveryPolicy?.reason, "quiet_hours");
});
