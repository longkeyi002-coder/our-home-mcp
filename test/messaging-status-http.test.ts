import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Runtime exited before health check with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Runtime did not become healthy");
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

test("compiled phone status exposes P2 capability categories without secrets", { timeout: 15_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-messaging-status-"));
  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OUR_HOME_MCP_TRANSPORT: "http",
      OUR_HOME_MCP_HOST: "127.0.0.1",
      OUR_HOME_MCP_PORT: String(port),
      OUR_HOME_DATA_FILE: join(dir, "data.json"),
      OUR_HOME_SEED: "false",
      OUR_HOME_MCP_TOKEN: "admin-secret",
      OUR_HOME_RUN_WORKER: "false",
      OUR_HOME_FIREBASE_PROJECT_ID: "private-project-id",
      GOOGLE_APPLICATION_CREDENTIALS: "/private/service-account.json",
      OUR_HOME_HERMES_API_URL: "https://private-hermes.example",
      OUR_HOME_HERMES_API_KEY: "private-hermes-key",
    },
    stdio: "ignore",
  });
  t.after(() => stopChild(child));
  await waitForHealth(baseUrl, child);

  const response = await fetch(`${baseUrl}/v1/phone/status`, {
    headers: { authorization: "Bearer admin-secret" },
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text) as { messaging: unknown; devices: unknown[] };
  assert.deepEqual(body.messaging, {
    workerEnabled: false,
    notifier: "fcm",
    brain: "hermes",
    fcmConfigured: true,
  });
  assert.deepEqual(body.devices, []);

  for (const secret of [
    "admin-secret",
    "private-project-id",
    "/private/service-account.json",
    "private-hermes.example",
    "private-hermes-key",
  ]) {
    assert.equal(text.includes(secret), false);
  }
});
