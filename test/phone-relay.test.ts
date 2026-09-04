import test from "node:test";
import assert from "node:assert/strict";
import { parseRelayResponse, secretMatches } from "../src/phone-relay.js";

test("phone relay accepts an Android MCP response frame", () => {
  assert.deepEqual(
    parseRelayResponse(JSON.stringify({
      id: "relay-1",
      status: 200,
      contentType: "application/json",
      body: "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
    })),
    {
      id: "relay-1",
      status: 200,
      contentType: "application/json",
      body: "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
    },
  );
});

test("phone relay preserves empty 202 notification responses", () => {
  assert.deepEqual(
    parseRelayResponse(JSON.stringify({ id: "relay-2", status: 202, body: "" })),
    { id: "relay-2", status: 202, body: "" },
  );
});

test("phone relay rejects malformed response frames", () => {
  assert.equal(parseRelayResponse("not-json"), undefined);
  assert.equal(parseRelayResponse(JSON.stringify({ id: 1, status: 200, body: "{}" })), undefined);
  assert.equal(parseRelayResponse(JSON.stringify({ id: "x", status: 999, body: "{}" })), undefined);
});

test("relay token comparisons require exact values", () => {
  assert.equal(secretMatches("abc", "abc"), true);
  assert.equal(secretMatches("abc", "abcd"), false);
  assert.equal(secretMatches("abc", "abd"), false);
});
