import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store.js";
import { registerPhone } from "../src/phone-registration.js";

test("OH-P1 enrollment token ignores surrounding whitespace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-enrollment-trim-"));
  const store = await JsonStore.open(join(dir, "data.json"), false);

  const result = await registerPhone(
    store,
    "ingest-secret",
    "Bearer enrollment-secret",
    { deviceId: "android-trim-test", appVersion: "0.1.0" },
    "  enrollment-secret  ",
  );

  assert.equal(result.deviceId, "android-trim-test");
  assert.ok(result.token.length > 20);
});

test("OH-P1 Runtime refuses identical enrollment and ingest credentials at startup", { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "our-home-auth-config-"));
  let stderr = "";
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OUR_HOME_MCP_TRANSPORT: "http",
      OUR_HOME_MCP_HOST: "127.0.0.1",
      OUR_HOME_MCP_PORT: "18787",
      OUR_HOME_DATA_FILE: join(dir, "data.json"),
      OUR_HOME_SEED: "false",
      OUR_HOME_MCP_TOKEN: "mcp-secret",
      OUR_HOME_INGEST_TOKEN: "same-secret",
      OUR_HOME_ENROLLMENT_TOKEN: "  same-secret  ",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

  const [code] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  assert.notEqual(code, 0);
  assert.match(stderr, /OUR_HOME_ENROLLMENT_TOKEN must differ from OUR_HOME_INGEST_TOKEN/);
});
