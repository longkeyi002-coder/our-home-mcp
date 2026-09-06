import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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
      // Runtime may still be binding.
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

test("OH-P1 enrollment token can register but cannot ingest telemetry directly", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-enrollment-"));
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
      OUR_HOME_DATA_FILE: join(dir, "data.json"),
      OUR_HOME_SEED: "false",
      OUR_HOME_INGEST_TOKEN: "ingest-secret",
      OUR_HOME_ENROLLMENT_TOKEN: "enrollment-secret",
      OUR_HOME_MCP_TOKEN: "mcp-secret",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-10_000); });
  t.after(() => stopChild(child));
  await waitForHealth(baseUrl, child, () => stderr);

  const register = await fetch(`${baseUrl}/v1/phone/register`, {
    method: "POST",
    headers: {
      authorization: "Bearer enrollment-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ deviceId: "android-enrolled", appVersion: "0.1.0" }),
  });
  assert.equal(register.status, 201);
  const registration = await register.json() as { token: string };
  assert.ok(registration.token.length > 20);

  const enrollmentHeartbeat = await fetch(`${baseUrl}/v1/phone/heartbeat`, {
    method: "POST",
    headers: {
      authorization: "Bearer enrollment-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "android-enrolled",
      observedAt: "2026-09-04T11:00:00.000Z",
      clientEventId: "enrollment-direct-heartbeat",
    }),
  });
  assert.equal(enrollmentHeartbeat.status, 401);

  const enrollmentObservation = await fetch(`${baseUrl}/v1/observations`, {
    method: "POST",
    headers: {
      authorization: "Bearer enrollment-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "android-enrolled",
      kind: "note",
      label: "must be rejected",
      observedAt: "2026-09-04T11:00:01.000Z",
    }),
  });
  assert.equal(enrollmentObservation.status, 401);

  const deviceHeartbeat = await fetch(`${baseUrl}/v1/phone/heartbeat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${registration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "android-enrolled",
      observedAt: "2026-09-04T11:00:02.000Z",
      clientEventId: "device-heartbeat-after-enrollment",
    }),
  });
  assert.equal(deviceHeartbeat.status, 201);

  // An already-enrolled phone must be able to refresh its own push address without
  // retaining a long-lived copy of the enrollment credential.
  const selfRefresh = await fetch(`${baseUrl}/v1/phone/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${registration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "android-enrolled",
      appVersion: "0.1.88",
      pushFid: "fid-refreshed",
      pushToken: "fcm-refreshed",
    }),
  });
  assert.equal(selfRefresh.status, 201);

  // A device-scoped token is bound to its deviceId and cannot update another phone.
  const crossDeviceRefresh = await fetch(`${baseUrl}/v1/phone/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${registration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "android-other",
      pushFid: "fid-other",
      pushToken: "fcm-other",
    }),
  });
  assert.equal(crossDeviceRefresh.status, 401);
});
