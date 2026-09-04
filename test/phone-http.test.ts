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
      // The child may still be binding the socket.
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

test("OH-P1 real HTTP register heartbeat retry and observation persist one factual stream", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-phone-http-"));
  const dataFile = join(dir, "data.json");
  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OUR_HOME_MCP_TRANSPORT: "http",
      OUR_HOME_MCP_HOST: "127.0.0.1",
      OUR_HOME_MCP_PORT: String(port),
      OUR_HOME_DATA_FILE: dataFile,
      OUR_HOME_SEED: "false",
      OUR_HOME_INGEST_TOKEN: "bootstrap-secret",
      OUR_HOME_MCP_TOKEN: "mcp-secret",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-10_000); });
  t.after(() => stopChild(child));

  await waitForHealth(baseUrl, child, () => stderr);

  const unauthorized = await fetch(`${baseUrl}/v1/phone/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "android-http", observedAt: "2026-09-04T07:00:00.000Z" }),
  });
  assert.equal(unauthorized.status, 401);

  const register = await fetch(`${baseUrl}/v1/phone/register`, {
    method: "POST",
    headers: {
      authorization: "Bearer bootstrap-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ deviceId: "android-http", appVersion: "0.1.0" }),
  });
  assert.equal(register.status, 201);
  const registration = await register.json() as { token: string };
  assert.ok(registration.token.length > 20);

  const heartbeatBody = {
    deviceId: "android-http",
    batteryPercent: 47,
    charging: true,
    appVersion: "0.1.0",
    connectivityState: "online",
    foregroundPackage: "com.example.reader",
    observedAt: "2026-09-04T07:01:00.000Z",
    clientEventId: "heartbeat-http-1",
  };
  const sendHeartbeat = () => fetch(`${baseUrl}/v1/phone/heartbeat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${registration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(heartbeatBody),
  });

  const firstHeartbeat = await sendHeartbeat();
  assert.equal(firstHeartbeat.status, 201);
  const retryHeartbeat = await sendHeartbeat();
  assert.equal(retryHeartbeat.status, 200);

  const usage = await fetch(`${baseUrl}/v1/observations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${registration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "android-http",
      kind: "usage_summary",
      label: "app usage timeline",
      value: "com.example.reader",
      observedAt: "2026-09-04T07:02:00.000Z",
      clientEventId: "usage-http-1",
      metadata: { currentPackage: "com.example.reader", currentDurationMs: "60000" },
    }),
  });
  assert.equal(usage.status, 201);

  await stopChild(child);
  const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
    phoneDeviceRegistrations: Array<{ deviceId: string }>;
    observations: Array<{
      kind: string;
      deviceId?: string;
      source: string;
      confidence: string;
      observedAt: string;
      metadata?: Record<string, unknown>;
    }>;
  };

  assert.equal(persisted.phoneDeviceRegistrations.filter((item) => item.deviceId === "android-http").length, 1);
  const phone = persisted.observations.filter((item) => item.deviceId === "android-http");
  assert.equal(phone.filter((item) => item.kind === "device_presence").length, 1);
  assert.equal(phone.filter((item) => item.kind === "screen_app").length, 1);
  assert.equal(phone.filter((item) => item.kind === "usage_summary").length, 1);
  assert.ok(phone.every((item) => item.source === "phone" && item.confidence === "observed"));
  assert.equal(phone.find((item) => item.kind === "device_presence")?.metadata?.clientEventId, "heartbeat-http-1");
  assert.equal(phone.find((item) => item.kind === "usage_summary")?.metadata?.clientEventId, "usage-http-1");
});
