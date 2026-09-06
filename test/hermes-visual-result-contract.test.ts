import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { HermesDecisionEngine } from "../src/hermes-decision.js";
import type { LifeContext, WakeEvent } from "../src/types.js";

const state = {
  lastObservedAt: "2026-09-05T12:11:20.000Z",
  lastPhoneActivityAt: "2026-09-05T12:11:20.000Z",
  devicePresence: "screen_on" as const,
  foregroundPackage: "com.example.game",
  foregroundSessionStartedAt: "2026-09-05T12:00:00.000Z",
  foregroundDwellMs: 680_000,
  batteryPercent: 80,
  charging: false,
  connectivityState: "online" as const,
  currentActivity: "active_on_phone" as const,
  confidence: 0.9,
  reasons: ["visual summary available"],
};

const wake: WakeEvent = {
  id: "wake-visual-result",
  type: "visual_result",
  status: "pending",
  priority: "normal",
  createdAt: "2026-09-05T12:12:00.000Z",
  observedAt: "2026-09-05T12:11:20.000Z",
  reason: "A requested visual observation completed. Decide separately whether the structured result warrants contacting the user.",
  dedupeKey: "visual_result:request-1",
  lifeState: state,
  previousLifeState: state,
};

const context: LifeContext = {
  observedAt: "2026-09-05T12:12:00.000Z",
  lifeState: state,
  observations: [{
    id: "visual-summary-1",
    world: "EARTH",
    provenance: "observed",
    kind: "visual_observation_summary",
    label: "gaming",
    value: "gameplay visible",
    observedAt: "2026-09-05T12:11:20.000Z",
    source: "phone",
    confidence: "observed",
    deviceId: "android-1",
    metadata: {
      requestId: "request-1",
      packageName: "com.example.game",
      sessionId: "com.example.game:1788619200000",
    },
  }],
  routines: [],
  recentHeartbeats: [],
  pendingProactiveMessages: [],
  pendingWakeEvents: [wake],
};

async function fakeHermes(decision: unknown) {
  let requestBody: any;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(decision) }],
      }],
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    body: () => requestBody,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("OH-44: Hermes receives visual_result as a separate Care decision", async (t) => {
  const fake = await fakeHermes({
    action: "proactive_message",
    candidate: { title: "休息一下？", message: "需要我陪你聊会儿吗？", reason: "visual result" },
  });
  t.after(fake.close);
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });

  const decision = await engine.evaluate({ wakeEvent: wake, context });

  assert.equal(decision.action, "proactive_message");
  assert.match(fake.body().input, /separate Care decision/);
  assert.match(fake.body().input, /seeing something does not imply contacting the user/);
  assert.match(fake.body().input, /visual_observation_summary/);
});

test("OH-44: Hermes cannot turn visual_result into another visual request", async (t) => {
  const fake = await fakeHermes({ action: "request_visual", reason: "look again" });
  t.after(fake.close);
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });

  await assert.rejects(
    engine.evaluate({ wakeEvent: wake, context }),
    /Only a visual opportunity may request visual observation/,
  );
});
