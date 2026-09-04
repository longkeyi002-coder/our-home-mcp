import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

async function reserveFreePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess, stderr: () => string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Runtime exited before health check: ${stderr()}`);
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // compiled runtime is still binding
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Runtime did not become healthy: ${stderr()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit").then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("OH-P1.5 compiled HTTP runtime accepts and persists realtime Presence kinds", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-presence-http-"));
  const dataFile = join(dir, "data.json");
  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = "";

  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OUR_HOME_MCP_TRANSPORT: "http",
      OUR_HOME_MCP_HOST: "127.0.0.1",
      OUR_HOME_MCP_PORT: String(port),
      OUR_HOME_DATA_FILE: dataFile,
      OUR_HOME_SEED: "false",
      OUR_HOME_INGEST_TOKEN: "bootstrap-secret",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-10_000); });
  t.after(() => stopChild(child));
  await waitForHealth(baseUrl, child, () => stderr);

  const register = await fetch(`${baseUrl}/v1/phone/register`, {
    method: "POST",
    headers: { authorization: "Bearer bootstrap-secret", "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "android-presence", appVersion: "0.2.0" }),
  });
  assert.equal(register.status, 201);
  const { token } = await register.json() as { token: string };

  const observations = [
    {
      kind: "presence_app_transition",
      label: "com.example.game",
      value: "com.example.game",
      observedAt: "2026-09-05T00:00:00.000Z",
      clientEventId: "presence-transition-1",
      metadata: { fromPackage: "com.example.chat", toPackage: "com.example.game", previousDurationMs: "120000" },
    },
    {
      kind: "presence_app_dwell",
      label: "com.example.game",
      value: "20m",
      observedAt: "2026-09-05T00:20:00.000Z",
      clientEventId: "presence-dwell-1",
      metadata: { packageName: "com.example.game", durationMs: "1200000", stage: "2", stageLabel: "20m" },
    },
    {
      kind: "presence_screen",
      label: "screen_off",
      value: "off",
      observedAt: "2026-09-05T00:21:00.000Z",
      clientEventId: "presence-screen-1",
      metadata: { interactive: "false", unlocked: "false", reason: "screen_off" },
    },
    {
      kind: "visual_policy_audit",
      label: "capture_request",
      value: "PROTECTED_REQUIRES_TEMPORARY_GRANT",
      observedAt: "2026-09-05T00:22:00.000Z",
      clientEventId: "visual-audit-1",
      metadata: { packageName: "com.example.bank", allowed: "false", sensitivity: "PROTECTED" },
    },
  ];

  for (const observation of observations) {
    const response = await fetch(`${baseUrl}/v1/observations`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "android-presence", ...observation }),
    });
    assert.equal(response.status, 201, `${observation.kind} should be accepted: ${await response.text()}`);
  }

  await stopChild(child);
  const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
    observations: Array<{ kind: string; source: string; confidence: string; metadata?: Record<string, unknown> }>;
  };
  const phone = persisted.observations.filter((item) => observations.some((expected) => expected.kind === item.kind));
  assert.deepEqual(phone.map((item) => item.kind), observations.map((item) => item.kind));
  assert.ok(phone.every((item) => item.source === "phone" && item.confidence === "observed"));
  assert.equal(phone.find((item) => item.kind === "visual_policy_audit")?.metadata?.allowed, "false");
});
