# Android Phone Reverse Relay

This is the missing bridge between a remote Hermes process and the Android Companion's loopback MCP server.

## Data path

```text
Hermes on Alibaba Cloud
  -> POST http://127.0.0.1:8790/mcp (Bearer relay MCP token)
  -> Phone Relay
  -> existing Android WebSocket
  -> Android Companion
  -> http://127.0.0.1:5000/mcp/<installation-secret>
  -> get_local_health / get_device_context / get_current_usage / send_local_notification
  -> response travels back over the same WebSocket
  -> Hermes
```

The Android phone is always the side that dials out. Port 5000 never needs to be exposed to the internet.

## 1. Install/build

```bash
npm install
npm run build
```

`npm run start:relay` starts the relay on `127.0.0.1:8790` by default.

## 2. Configure relay environment

Use real secrets in the server environment; do not commit them.

```bash
export OUR_HOME_RELAY_HOST=127.0.0.1
export OUR_HOME_RELAY_PORT=8790
export OUR_HOME_RELAY_TUNNEL_TOKEN='<must match the token provisioned into the Android prototype>'
export OUR_HOME_RELAY_MCP_TOKEN='<separate strong token used only by Hermes>'
export OUR_HOME_RELAY_DEVICE_ID='<the Android prototype device id>'
export OUR_HOME_RELAY_REQUEST_TIMEOUT_MS=30000
export OUR_HOME_RELAY_MAX_IN_FLIGHT=32
npm run start:relay
```

Expected log:

```text
[our-home-relay] listening at http://127.0.0.1:8790; phone WSS upgrades on /; Hermes MCP on /mcp
```

## 3. Put Cloudflare in front of port 8790

For the current prototype, cloudflared must forward the hostname baked into the APK to:

```text
http://127.0.0.1:8790
```

The phone connects with:

```text
wss://<relay-host>/?token=<phone-token>
```

For long-running use, replace TryCloudflare Quick Tunnel with a Named Tunnel / stable hostname. Quick Tunnel hostnames are prototype-only and should not be treated as permanent provisioning.

## 4. Verify the phone is actually connected

On the Alibaba Cloud host:

```bash
curl -sS \
  -H "Authorization: Bearer $OUR_HOME_RELAY_MCP_TOKEN" \
  http://127.0.0.1:8790/v1/relay/status
```

Expected shape once the Android Companion shows a live relay connection:

```json
{
  "connected": true,
  "devices": [
    {
      "deviceId": "<android-device-id>",
      "connectedAt": "2026-09-04T00:00:00.000Z",
      "inFlight": 0
    }
  ]
}
```

If `connected` is false, Hermes cannot reach the phone yet. Fix the Android -> Cloudflare -> relay leg before testing MCP.

## 5. Smoke-test MCP through the phone

Initialize:

```bash
curl -i \
  -H "Authorization: Bearer $OUR_HOME_RELAY_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"relay-smoke","version":"0.1"}}}' \
  http://127.0.0.1:8790/mcp
```

Then list tools:

```bash
curl -sS \
  -H "Authorization: Bearer $OUR_HOME_RELAY_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  http://127.0.0.1:8790/mcp
```

Then read the phone:

```bash
curl -sS \
  -H "Authorization: Bearer $OUR_HOME_RELAY_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_device_context","arguments":{}}}' \
  http://127.0.0.1:8790/mcp
```

The Android Companion home should then show that Hermes/the relay actually performed an MCP phone capability call.

## 6. Hermes configuration target

Once the smoke test works, configure Hermes's remote MCP endpoint to:

```text
http://127.0.0.1:8790/mcp
```

with:

```text
Authorization: Bearer <OUR_HOME_RELAY_MCP_TOKEN>
```

This endpoint is intentionally separate from the Our Home Runtime MCP endpoint on port 8787.

## Failure semantics

- `401`: wrong Hermes relay token.
- `503`: Android phone is not connected to the relay.
- `429`: too many concurrent relay requests.
- `504`: phone did not answer within the configured timeout.
- `502`: relay/socket/local-phone MCP failure.

The relay keeps at most a bounded number of in-flight MCP calls per connected phone and rejects pending calls when that phone disconnects or is replaced.
