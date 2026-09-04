import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function kotlinFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await kotlinFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".kt")) result.push(path);
  }
  return result;
}

function runtimeKinds(indexSource: string): Set<string> {
  const match = indexSource.match(/kind:\s*z\.enum\(\[([\s\S]*?)\]\)/);
  assert.ok(match, "Runtime phone observation z.enum must remain discoverable by contract test");
  return new Set([...match[1]!.matchAll(/"([a-z0-9_]+)"/g)].map((item) => item[1]!));
}

function emittedAndroidKinds(source: string): string[] {
  return [...source.matchAll(/kind\s*=\s*"([a-z0-9_]+)"/g)].map((item) => item[1]!);
}

test("every Android ObservationRequest kind is accepted by Runtime HTTP schema", async () => {
  const runtimeSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const accepted = runtimeKinds(runtimeSource);
  const androidRoot = new URL("../android-companion/app/src/main/java", import.meta.url);
  const files = await kotlinFiles(androidRoot.pathname);
  const emitted = new Set<string>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    emittedAndroidKinds(source).forEach((kind) => emitted.add(kind));
  }

  assert.ok(emitted.size > 0, "contract test must discover Android observation kinds");
  const unsupported = [...emitted].filter((kind) => !accepted.has(kind)).sort();
  assert.deepEqual(unsupported, [], `Android emits kinds Runtime rejects: ${unsupported.join(", ")}`);
  assert.equal(emitted.has("app_timeline"), false, "removed app_timeline path must not return without Runtime support");
  assert.equal(emitted.has("steps"), false, "removed steps path must not return without Runtime support");
});
