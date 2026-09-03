undefined

test("same Wake Event retries after Hermes failure and succeeds once", async (t) => {
  let calls = 0;
  const server = createServer(async (_request, response) => {
    calls += 1;
    if (calls === 1) {
      response.writeHead(500).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      output: [{ type: "message", role: "assistant", content: [{
        type: "output_text",
        text: JSON.stringify({ action: "proactive_message", candidate: { title: "提醒", message: "休息一下", reason: "wake" } }),
      }] }],
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const directory = await mkdtemp(join(tmpdir(), "our-home-hermes-retry-"));
  const store = await JsonStore.open(join(directory, "our-home.json"), false);
  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(0)));
  await store.recordObservation({ kind: "screen_app", label: "foreground", value: "com.example.app", observedAt: at(1), source: "phone", confidence: "observed" });
  await store.evaluateWakeEvents(at(2));
  const event = store.listWakeEvents()[0]!;
  const engine = new HermesDecisionEngine({ apiUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-secret" });

  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(3)), engine);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === event.id)?.status, "pending");
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 0);

  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(4)), engine);
  assert.equal(store.snapshot().wakeEvents.find((item) => item.id === event.id)?.status, "handled");
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 1);
  assert.equal(store.snapshot().proactiveQueue.find((item) => item.wakeEventId === event.id)?.wakeEventId, event.id);
  assert.equal(calls, 2);

  await runProactiveCycle(store, { deliver: async () => {} }, new Date(at(5)), engine);
  assert.equal(calls, 2);
  assert.equal(store.snapshot().proactiveQueue.filter((item) => item.wakeEventId === event.id).length, 1);
});
