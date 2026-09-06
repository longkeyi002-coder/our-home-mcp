import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { HermesDecisionEngine } from "../src/hermes-decision.js";
import type { LifeContext, WakeEvent } from "../src/types.js";

const output = (decision: unknown) => ({
  output: [{
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: JSON.stringify(decision) }],
  }],
});

async function fakeHermes(decision: unknown) {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output(decision)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function transitionWake(): WakeEvent {
  const observedAt = "2026-09-06T02:20:00.000Z";
  return {
    id: "wake-transition",
    type: "visual_opportunity",
    status: "pending",
    priority: "low",
    createdAt: observedAt,
    observedAt,
    reason: "App transition attention",
    dedupeKey: "transition-attention",
    lifeState: {
      lastObservedAt: observedAt,
      lastPhoneActivityAt: observedAt,
      devicePresence: "active",
      foregroundPackage: "com.example.chat",
      foregroundSessionStartedAt: observedAt,
      foregroundDwellMs: 0,
      batteryPercent: 80,
      charging: false,
      connectivityState: "online",
      currentActivity: "unknown",
      confidence: 1,
      reasons: [],
    },
    previousLifeState: {
      lastObservedAt: observedAt,
      lastPhoneActivityAt: observedAt,
      devicePresence: "active",
      foregroundPackage: "com.example.home",
      foregroundSessionStartedAt: observedAt,
      foregroundDwellMs: 0,
      batteryPercent: 80,
      charging: false,
      connectivityState: "online",
      currentActivity: "unknown",
      confidence: 1,
      reasons: [],
    },
    visualContext: {
      deviceId: "android-1",
      packageName: "com.example.chat",
      sessionId: `com.example.chat:${Date.parse(observedAt)}`,
      curiosityReason: "app_transition",
      expiresAt: "2026-09-06T02:25:00.000Z",
    },
  };
}

const context = {
  observedAt: "2026-09-06T02:20:01.000Z",
  lifeState: transitionWake().lifeState,
  observations: [],
  routines: [],
  recentHeartbeats: [],
  pendingProactiveMessages: [],
  pendingWakeEvents: [],
} satisfies LifeContext;

test("Hermes is notified of app transition but cannot suppress the required first look", async (t) => {
  const fake = await fakeHermes({ action: "ignore" });
  t.after(fake.close);
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });

  const decision = await engine.evaluate({ wakeEvent: transitionWake(), context });

  assert.equal(fake.requests.length, 1);
  assert.match(fake.requests[0].input, /phone has just detected a real foreground App transition/i);
  assert.deepEqual(decision, { action: "request_visual", reason: "app_transition_attention" });
});

test("ordinary curiosity visual opportunity may still be ignored", async (t) => {
  const fake = await fakeHermes({ action: "ignore" });
  t.after(fake.close);
  const engine = new HermesDecisionEngine({ apiUrl: fake.url, apiKey: "secret" });
  const wake = transitionWake();
  wake.visualContext = { ...wake.visualContext!, curiosityReason: "unknown_context" };

  const decision = await engine.evaluate({ wakeEvent: wake, context });

  assert.deepEqual(decision, { action: "ignore" });
});
