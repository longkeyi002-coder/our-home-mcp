import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { listenOrThrow } from "../src/http-listen.js";

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("listenOrThrow resolves only after the socket is bound", async () => {
  const server = createServer();
  await listenOrThrow(server, 0, "127.0.0.1");
  assert.equal(server.listening, true);
  await closeServer(server);
});

test("listenOrThrow rejects EADDRINUSE before caller can continue", async () => {
  const owner = createServer();
  owner.listen(0, "127.0.0.1");
  await once(owner, "listening");
  const address = owner.address();
  assert.ok(address && typeof address !== "string");

  const second = createServer();
  await assert.rejects(
    listenOrThrow(second, address.port, "127.0.0.1"),
    (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
  );
  assert.equal(second.listening, false);
  await closeServer(owner);
});
