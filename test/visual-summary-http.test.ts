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

test("OH-42 visual summary accepts minimized context and rejects raw screen data", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-visual-summary-"));
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
    body: JSON.stringify({ deviceId: "android-vision", appVersion: "0.2.0" }),
  });
  assert.equal(register.status, 201);
  const { token } = await register.json() as { token: string };

  const validBody = {
    deviceId: "android-vision",
    kind: "visual_observation_summary",
    label: "gaming",
    value: "generic battle scene",
    observedAt: "2026-09-05T00:30:00.000Z",
    clientEventId: "visual-summary-1",
    metadata: {
      packageName: "com.example.game",
      activity: "gaming",
      confidence: "0.91",
      provider: "zhipu",
      model: "glm-4.6v-flash",
      requestId: "request-1",
      sessionId: "com.example.game:100",
      curiosityReason: "unknown_dwell",
    },
  };
  const valid = await fetch(`${baseUrl}/v1/observations`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(validBody),
  });
  assert.equal(valid.status, 201, await valid.text());

  for (const forbidden of [
    { imageBase64: "AAAA" },
    { rawText: "secret message" },
    { ocr: "123456" },
    { screenshot: "binary-ish" },
  ]) {
    const response = await fetch(`${baseUrl}/v1/observations`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        clientEventId: `forbidden-${Object.keys(forbidden)[0]}`,
        metadata: { ...validBody.metadata, ...forbidden },
      }),
    });
    assert.equal(response.status, 400, `${Object.keys(forbidden)[0]} must be rejected`);
  }

  const tooVerbose = await fetch(`${baseUrl}/v1/observations`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...validBody, clientEventId: "too-long", value: "x".repeat(241) }),
  });
  assert.equal(tooVerbose.status, 400);

  await stopChild(child);
  const persisted = JSON.parse(await readFile(dataFile, "utf8")) as {
    observations: Array<{ kind: string; value?: string; metadata?: Record<string, unknown> }>;
  };
  const visual = persisted.observations.filter((item) => item.kind === "visual_observation_summary");
  assert.equal(visual.length, 1);
  assert.equal(visual[0]?.value, "generic battle scene");
  assert.equal(visual[0]?.metadata?.activity, "gaming");
  assert.ok(!("imageBase64" in (visual[0]?.metadata ?? {})));
  assert.ok(!("rawText" in (visual[0]?.metadata ?? {})));
});
