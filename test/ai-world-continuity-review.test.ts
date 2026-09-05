import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advancePersistedAiWorld } from "../src/ai-world-store.js";
import {
  addAiWorldExperience,
  listDueAiWorldReviews,
  reviewAiWorldExperience,
} from "../src/ai-world-continuity.js";
import { JsonStore } from "../src/store.js";

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "our-home-continuity-review-cycle-"));
  const result = await JsonStore.open(join(directory, "data.json"), false);
  await advancePersistedAiWorld(result, "2026-09-05T10:00:00.000Z", "UTC");
  return result;
}

test("OH-22/OH-P4: reviewed Experience can be cleared or rescheduled without rewriting its content/boundary", async () => {
  const runtime = await store();
  const experience = await addAiWorldExperience(runtime, {
    summary: "值得以后回看的经历。",
    occurredAt: "2026-09-05T10:00:00.000Z",
    provenance: "authored",
    nextReviewAt: "2026-09-05T12:00:00.000Z",
  }, "2026-09-05T10:01:00.000Z");

  assert.deepEqual(
    listDueAiWorldReviews(runtime, "2026-09-05T12:30:00.000Z").map((item) => item.recordId),
    [experience.id],
  );

  const rescheduled = await reviewAiWorldExperience(
    runtime,
    experience.id,
    "2026-09-06T12:30:00.000Z",
    "2026-09-05T12:30:00.000Z",
  );
  assert.equal(rescheduled.lastReviewedAt, "2026-09-05T12:30:00.000Z");
  assert.equal(rescheduled.nextReviewAt, "2026-09-06T12:30:00.000Z");
  assert.equal(rescheduled.summary, experience.summary);
  assert.deepEqual(
    [rescheduled.world, rescheduled.provenance, rescheduled.source],
    ["AI_WORLD", "authored", "AGENT_LIFE"],
  );
  assert.equal(listDueAiWorldReviews(runtime, "2026-09-05T12:31:00.000Z").length, 0);

  const cleared = await reviewAiWorldExperience(
    runtime,
    experience.id,
    null,
    "2026-09-06T12:31:00.000Z",
  );
  assert.equal(cleared.lastReviewedAt, "2026-09-06T12:31:00.000Z");
  assert.equal(cleared.nextReviewAt, undefined);
  assert.equal(listDueAiWorldReviews(runtime, "2026-09-07T12:00:00.000Z").length, 0);
});

test("OH-64/OH-65: review reschedule cannot point into the past and create immediate retry churn", async () => {
  const runtime = await store();
  const experience = await addAiWorldExperience(runtime, {
    summary: "复盘时间保护。",
    occurredAt: "2026-09-05T10:00:00.000Z",
    provenance: "authored",
  }, "2026-09-05T10:01:00.000Z");

  await assert.rejects(
    reviewAiWorldExperience(
      runtime,
      experience.id,
      "2026-09-05T11:00:00.000Z",
      "2026-09-05T12:00:00.000Z",
    ),
    /nextReviewAt cannot precede/,
  );
});
