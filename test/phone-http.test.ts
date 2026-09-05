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
      // The compiled child may still be binding the socket.
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

test("OH-P1 compiled HTTP runtime supports bootstrap ingest, device auth, status and persistence", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-phone-http-"));
  const dataFile = join(dir, "data.json");
  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = "";

  // OH-P1.9: exercise the same compiled entry point used in production.
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
      OUR_HOME_MCP_TOKEN: "mcp-secret",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-10_000); });
  t.after(() => stopChild(child));

  await waitForHealth(baseUrl, child, () => stderr);

  // OH-30/OH-32: phone endpoints must not silently relabel a fictional payload.
  for (const path of ["/v1/observations", "/v1/phone/heartbeat"]) {
    const rejected = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: "Bearer bootstrap-secret", "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "android-http", kind: "note", label: "story", world: "FICTION", provenance: "authored" }),
    });
    assert.equal(rejected.status, 400);
  }


  const unauthorized = await fetch(`${baseUrl}/v1/phone/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "android-http", observedAt: "2026-09-04T07:00:00.000Z" }),
  });
  assert.equal(unauthorized.status, 401);

  // OH-P1.9 regression: the bootstrap/ingest token is valid for protected ingest
  // even before a device has registered for its scoped device credential.
  const bootstrapHeartbeat = await fetch(`${baseUrl}/v1/phone/heartbeat`, {
    method: "POST",
    headers: {
      authorization: "Bearer bootstrap-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "bootstrap-direct",
      batteryPercent: 64,
      charging: false,
      connectivityState: "online",
      observedAt: "2026-09-04T06:58:00.000Z",
      clientEventId: "bootstrap-heartbeat-1",
    }),
  });
  assert.equal(bootstrapHeartbeat.status, 201);

  const bootstrapObservation = await fetch(`${baseUrl}/v1/observations`, {
    method: "POST",
    headers: {
      authorization: "Bearer bootstrap-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "bootstrap-direct",
      kind: "note",
      label: "bootstrap ingest probe",
      value: "ok",
      observedAt: "2026-09-04T06:59:00.000Z",
      clientEventId: "bootstrap-observation-1",
    }),
  });
  assert.equal(bootstrapObservation.status, 201);

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

  // OH-P1.9 regression: this must be present on the compiled runtime, not only src/.
  const unauthorizedStatus = await fetch(`${baseUrl}/v1/phone/status`);
  assert.equal(unauthorizedStatus.status, 401);
  const statusResponse = await fetch(`${baseUrl}/v1/phone/status`, {
    headers: { authorization: "Bearer mcp-secret" },
  });
  assert.equal(statusResponse.status, 200);
  const statusText = await statusResponse.text();
  assert.doesNotMatch(statusText, new RegExp(registration.token));
  assert.doesNotMatch(statusText, /bootstrap-secret|mcp-secret/);
  const status = JSON.parse(statusText) as {
    devices: Array<{
      deviceId: string;
      registeredAt: string | null;
      appVersion: string | null;
      hasPushAddress: boolean;
      lastSeenAt: string | null;
      lastHeartbeatAt: string | null;
      lastObservationAt: string | null;
    }>;
  };

  const registeredStatus = status.devices.find((item) => item.deviceId === "android-http");
  assert.ok(registeredStatus);
  assert.equal(registeredStatus.appVersion, "0.1.0");
  assert.equal(registeredStatus.hasPushAddress, false);
  assert.equal(registeredStatus.lastSeenAt, "2026-09-04T07:02:00.000Z");
  assert.equal(registeredStatus.lastHeartbeatAt, "2026-09-04T07:01:00.000Z");
  assert.equal(registeredStatus.lastObservationAt, "2026-09-04T07:02:00.000Z");

  const bootstrapStatus = status.devices.find((item) => item.deviceId === "bootstrap-direct");
  assert.ok(bootstrapStatus);
  assert.equal(bootstrapStatus.registeredAt, null);
  assert.equal(bootstrapStatus.lastSeenAt, "2026-09-04T06:59:00.000Z");
  assert.equal(bootstrapStatus.lastHeartbeatAt, "2026-09-04T06:58:00.000Z");

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

  const bootstrapPhone = persisted.observations.filter((item) => item.deviceId === "bootstrap-direct");
  assert.equal(bootstrapPhone.filter((item) => item.kind === "device_presence").length, 1);
  assert.equal(bootstrapPhone.filter((item) => item.kind === "note").length, 1);
  assert.ok(bootstrapPhone.every((item) => item.source === "phone" && item.confidence === "observed"));
});

