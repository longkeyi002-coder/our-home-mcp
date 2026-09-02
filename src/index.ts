import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createOurHomeServer, type AuthContext } from "./server.js";
import { JsonStore, parseBoolean } from "./store.js";

const transportMode = process.env.OUR_HOME_MCP_TRANSPORT ?? "stdio";
const dataFile = process.env.OUR_HOME_DATA_FILE ?? "./data/our-home.sqlite";
const seed = parseBoolean(process.env.OUR_HOME_SEED, true);
const store = await JsonStore.open(dataFile, seed);

const phoneObservationSchema = z.object({
  kind: z.enum(["manual_status", "device_presence", "screen_app", "app_timeline", "steps", "calendar", "weather", "note"]),
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().max(2_000).optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  deviceId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const phoneObservationEnvelopeSchema = z.union([
  phoneObservationSchema,
  z.object({ observations: z.array(phoneObservationSchema).min(1).max(50) }),
]);

const phoneHeartbeatSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  status: z.enum(["online", "screen_on", "screen_off", "idle"]).default("online"),
  batteryPercent: z.number().min(0).max(100).optional(),
  charging: z.boolean().optional(),
  appVersion: z.string().trim().max(100).optional(),
  connectivityState: z.enum(["online", "offline", "unknown"]).optional(),
  foregroundPackage: z.string().trim().max(300).optional(),
  clientEventId: z.string().trim().max(200).optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
});

const phoneRegisterSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  appVersion: z.string().trim().max(100).optional(),
});

if (transportMode === "stdio") {
  const server = createOurHomeServer(store);
  await server.connect(new StdioServerTransport());
} else if (transportMode === "http") {
  await startHttpServer();
} else {
  throw new Error(`Unsupported OUR_HOME_MCP_TRANSPORT: ${transportMode}`);
}

async function startHttpServer(): Promise<void> {
  const host = process.env.OUR_HOME_MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.OUR_HOME_MCP_PORT ?? "8787");
  const token = process.env.OUR_HOME_MCP_TOKEN;
  const userToken = process.env.OUR_HOME_MCP_USER_TOKEN;
  const agentToken = process.env.OUR_HOME_MCP_AGENT_TOKEN;
  const legacyActor = process.env.OUR_HOME_MCP_ACTOR ?? "agent";
  if (legacyActor !== "user" && legacyActor !== "agent") throw new Error("OUR_HOME_MCP_ACTOR must be user or agent");
  const legacySubject = process.env.OUR_HOME_MCP_SUBJECT ?? `legacy-${legacyActor}`;
  const tokenContexts: Array<{ token: string; auth: AuthContext }> = [];
  if (token) tokenContexts.push({ token, auth: { actor: legacyActor, subject: legacySubject } });
  if (userToken) tokenContexts.push({ token: userToken, auth: { actor: "user", subject: process.env.OUR_HOME_MCP_USER_SUBJECT ?? "user" } });
  if (agentToken) tokenContexts.push({ token: agentToken, auth: { actor: "agent", subject: process.env.OUR_HOME_MCP_AGENT_SUBJECT ?? "agent" } });
  if (new Set(tokenContexts.map((entry) => entry.token)).size !== tokenContexts.length) {
    throw new Error("MCP actor tokens must be unique");
  }
  const corsOrigin = process.env.OUR_HOME_MCP_CORS_ORIGIN;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("OUR_HOME_MCP_PORT must be a valid TCP port");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && tokenContexts.length === 0) {
    throw new Error("Refusing non-local HTTP binding without OUR_HOME_MCP_TOKEN");
  }

  const httpServer = createServer(async (request, response) => {
    if (corsOrigin) response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ ok: true, service: "our-home", schemaVersion: 2 }),
      );
      return;
    }

    if (request.url === "/v1/observations" && request.method === "POST") {
      await handlePhoneObservations(request, response);
      return;
    }

    if (request.url === "/v1/phone/register" && request.method === "POST") {
      await handlePhoneRegister(request, response);
      return;
    }

    if (request.url === "/v1/phone/heartbeat" && request.method === "POST") {
      await handlePhoneHeartbeat(request, response);
      return;
    }

    if (request.url !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const auth = authenticateMcpRequest(request, tokenContexts);
    if (tokenContexts.length > 0 && !auth) {
      response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const body = await readJsonBody(request, 1_000_000);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = createOurHomeServer(store, auth ?? { actor: "agent", subject: "local-http" });
      response.on("close", () => void transport.close());
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      if (!response.headersSent) {
        response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
      } else {
        response.end();
      }
    }
  });

  httpServer.listen(port, host, () => {
    process.stderr.write(`Our Home MCP listening at http://${host}:${port}/mcp\n`);
  });
}

function authenticateMcpRequest(
  request: import("node:http").IncomingMessage,
  tokenContexts: Array<{ token: string; auth: AuthContext }>,
): AuthContext | undefined {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  if (!token) return undefined;
  return tokenContexts.find((entry) => constantTimeEqual(token, entry.token))?.auth;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function handlePhoneObservations(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const ingestToken = process.env.OUR_HOME_INGEST_TOKEN;
  if (!ingestToken) {
    response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Phone ingestion is not configured" }));
    return;
  }
  try {
    const parsed = phoneObservationEnvelopeSchema.safeParse(await readJsonBody(request, 256_000));
    if (!parsed.success) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: parsed.error.issues }));
      return;
    }
    const items = "observations" in parsed.data ? parsed.data.observations : [parsed.data];
    if (!authorizePhoneRequest(request, ingestToken, items.map((item) => item.deviceId))) {
      response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const observations = [];
    for (const item of items) {
      observations.push(await store.recordObservation({
        ...item,
        observedAt: item.observedAt ?? new Date().toISOString(),
        source: "phone",
        confidence: "observed",
      }));
    }
    response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ observations, dataSource: "phone-ingest" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Phone observation failed";
    response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
  }
}

async function handlePhoneHeartbeat(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const ingestToken = process.env.OUR_HOME_INGEST_TOKEN;
  if (!ingestToken) {
    response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Phone ingestion is not configured" }));
    return;
  }
  try {
    const parsed = phoneHeartbeatSchema.safeParse(await readJsonBody(request, 32_000));
    if (!parsed.success) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: parsed.error.issues }));
      return;
    }
    if (!authorizePhoneRequest(request, ingestToken, [parsed.data.deviceId])) {
      response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const observedAt = parsed.data.observedAt ?? new Date().toISOString();
    const metadata = {
      ...(parsed.data.batteryPercent === undefined ? {} : { batteryPercent: parsed.data.batteryPercent }),
      ...(parsed.data.charging === undefined ? {} : { charging: parsed.data.charging }),
      ...(parsed.data.appVersion === undefined ? {} : { appVersion: parsed.data.appVersion }),
      ...(parsed.data.connectivityState === undefined ? {} : { connectivityState: parsed.data.connectivityState }),
      ...(parsed.data.clientEventId === undefined ? {} : { clientEventId: parsed.data.clientEventId }),
    };
    const result = await store.recordPhoneHeartbeat({
      observedAt,
      deviceId: parsed.data.deviceId,
      status: parsed.data.status,
      clientEventId: parsed.data.clientEventId,
      foregroundPackage: parsed.data.foregroundPackage,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    response.writeHead(result.created ? 201 : 200, { "content-type": "application/json" }).end(JSON.stringify({
      observation: result.observation,
      foregroundObservation: result.foregroundObservation,
      dataSource: "phone-ingest",
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Phone heartbeat failed";
    response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
  }
}

async function handlePhoneRegister(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const ingestToken = process.env.OUR_HOME_INGEST_TOKEN;
  if (!ingestToken) {
    response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Phone registration is not configured" }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${ingestToken}`) {
    response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    const parsed = phoneRegisterSchema.safeParse(await readJsonBody(request, 16_000));
    if (!parsed.success) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: parsed.error.issues }));
      return;
    }
    response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({
      deviceId: parsed.data.deviceId,
      token: createDeviceToken(ingestToken, parsed.data.deviceId),
      appVersion: parsed.data.appVersion,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Phone registration failed";
    response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
  }
}

function createDeviceToken(ingestToken: string, deviceId: string): string {
  return createHmac("sha256", ingestToken).update(`hermes-phone-v1:${deviceId}`).digest("hex");
}

function authorizePhoneRequest(
  request: import("node:http").IncomingMessage,
  ingestToken: string,
  deviceIds: Array<string | undefined>,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization === `Bearer ${ingestToken}`) return true;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  const ids = [...new Set(deviceIds.filter((deviceId): deviceId is string => Boolean(deviceId)))];
  if (!token || ids.length !== 1) return false;
  const expected = createDeviceToken(ingestToken, ids[0]!);
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readJsonBody(request: import("node:http").IncomingMessage, maxBytes: number): Promise<unknown> {
  if (request.method === "GET" || request.method === "DELETE") return undefined;
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}
