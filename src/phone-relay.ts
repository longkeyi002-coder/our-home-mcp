import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const MAX_MCP_BODY_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_IN_FLIGHT = 32;

type RelayWireResponse = {
  id: string;
  status: number;
  contentType?: string;
  body?: string;
};

type PendingRequest = {
  timer: NodeJS.Timeout;
  resolve: (value: RelayWireResponse) => void;
  reject: (error: Error) => void;
};

type PhoneConnection = {
  deviceId: string;
  socket: WebSocket;
  connectedAt: string;
  pending: Map<string, PendingRequest>;
};

export type PhoneRelayOptions = {
  phoneToken: string;
  mcpToken: string;
  defaultDeviceId?: string;
  requestTimeoutMs?: number;
  maxInFlight?: number;
};

/**
 * Bridges a remote Android Companion WebSocket to a local HTTP MCP endpoint.
 * The phone dials out to this relay; Hermes talks to /mcp on localhost.
 */
export class PhoneRelay {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MCP_BODY_BYTES * 2 });
  private readonly phones = new Map<string, PhoneConnection>();
  private readonly requestTimeoutMs: number;
  private readonly maxInFlight: number;

  constructor(private readonly options: PhoneRelayOptions) {
    if (!options.phoneToken.trim()) throw new Error("OUR_HOME_RELAY_TUNNEL_TOKEN is required");
    if (!options.mcpToken.trim()) throw new Error("OUR_HOME_RELAY_MCP_TOKEN is required");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1_000) {
      throw new Error("OUR_HOME_RELAY_REQUEST_TIMEOUT_MS must be an integer of at least 1000ms");
    }
    if (!Number.isInteger(this.maxInFlight) || this.maxInFlight < 1 || this.maxInFlight > 256) {
      throw new Error("OUR_HOME_RELAY_MAX_IN_FLIGHT must be between 1 and 256");
    }
  }

  attachUpgrade(server: ReturnType<typeof createServer>): void {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://relay.local");
      if (url.pathname !== "/" && url.pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const token = url.searchParams.get("token") ?? "";
      if (!secretMatches(token, this.options.phoneToken)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const deviceId = (url.searchParams.get("deviceId") ?? this.options.defaultDeviceId ?? "").trim();
      if (!deviceId || deviceId.length > 200) {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (webSocket) => this.acceptPhone(deviceId, webSocket));
    });
  }

  async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://relay.local");
    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        ok: true,
        service: "our-home-phone-relay",
        connectedPhones: this.phones.size,
      }));
      return;
    }

    if (!this.authorizeMcp(request)) {
      response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/relay/status") {
      const devices = [...this.phones.values()].map((phone) => ({
        deviceId: phone.deviceId,
        connectedAt: phone.connectedAt,
        inFlight: phone.pending.size,
      }));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ connected: devices.length > 0, devices }));
      return;
    }

    if (url.pathname !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json", allow: "POST" }).end(JSON.stringify({ error: "POST required" }));
      return;
    }

    try {
      const body = await readBody(request, MAX_MCP_BODY_BYTES);
      if (!body) {
        response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "MCP body is required" }));
        return;
      }
      const requestedDeviceId = (url.searchParams.get("deviceId") ?? this.options.defaultDeviceId ?? "").trim();
      const phone = this.resolvePhone(requestedDeviceId);
      if (!phone) {
        response.writeHead(503, { "content-type": "application/json", "retry-after": "2" }).end(JSON.stringify({ error: "Phone is not connected" }));
        return;
      }
      const result = await this.forward(phone, body);
      const headers: Record<string, string> = { "content-length": Buffer.byteLength(result.body ?? "").toString() };
      if (result.body) headers["content-type"] = result.contentType || "application/json";
      response.writeHead(result.status, headers).end(result.body ?? "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Relay request failed";
      const status = message === "Phone relay request timed out" ? 504 : message === "Phone relay is busy" ? 429 : 502;
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
    }
  }

  status(): { connected: boolean; devices: Array<{ deviceId: string; connectedAt: string; inFlight: number }> } {
    const devices = [...this.phones.values()].map((phone) => ({
      deviceId: phone.deviceId,
      connectedAt: phone.connectedAt,
      inFlight: phone.pending.size,
    }));
    return { connected: devices.length > 0, devices };
  }

  private authorizeMcp(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Bearer ")) return false;
    return secretMatches(authorization.slice("Bearer ".length), this.options.mcpToken);
  }

  private resolvePhone(requestedDeviceId: string): PhoneConnection | undefined {
    if (requestedDeviceId) return this.phones.get(requestedDeviceId);
    if (this.phones.size !== 1) return undefined;
    return this.phones.values().next().value;
  }

  private acceptPhone(deviceId: string, socket: WebSocket): void {
    const previous = this.phones.get(deviceId);
    if (previous) {
      this.rejectPending(previous, new Error("Phone connection replaced"));
      previous.socket.close(4001, "replaced");
    }

    const connection: PhoneConnection = {
      deviceId,
      socket,
      connectedAt: new Date().toISOString(),
      pending: new Map(),
    };
    this.phones.set(deviceId, connection);

    socket.on("message", (data) => this.handlePhoneMessage(connection, data));
    socket.on("close", () => this.removePhone(connection, new Error("Phone disconnected")));
    socket.on("error", (error) => this.removePhone(connection, error instanceof Error ? error : new Error("Phone socket error")));
  }

  private handlePhoneMessage(connection: PhoneConnection, data: RawData): void {
    const parsed = parseRelayResponse(data.toString());
    if (!parsed) return;
    const pending = connection.pending.get(parsed.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    connection.pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  private removePhone(connection: PhoneConnection, error: Error): void {
    if (this.phones.get(connection.deviceId) !== connection) return;
    this.phones.delete(connection.deviceId);
    this.rejectPending(connection, error);
  }

  private rejectPending(connection: PhoneConnection, error: Error): void {
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    connection.pending.clear();
  }

  private forward(connection: PhoneConnection, body: string): Promise<RelayWireResponse> {
    if (connection.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Phone is not connected"));
    if (connection.pending.size >= this.maxInFlight) return Promise.reject(new Error("Phone relay is busy"));

    const relayId = randomUUID();
    const frame = JSON.stringify({ id: relayId, method: "mcp", path: "/mcp", body });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(relayId);
        reject(new Error("Phone relay request timed out"));
      }, this.requestTimeoutMs);
      connection.pending.set(relayId, { timer, resolve, reject });
      connection.socket.send(frame, (error) => {
        if (!error) return;
        const pending = connection.pending.get(relayId);
        if (!pending) return;
        clearTimeout(pending.timer);
        connection.pending.delete(relayId);
        pending.reject(error);
      });
    });
  }
}

export function parseRelayResponse(raw: string): RelayWireResponse | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.id !== "string") return undefined;
    if (typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 100 || value.status > 599) return undefined;
    if (value.body !== undefined && typeof value.body !== "string") return undefined;
    if (value.contentType !== undefined && typeof value.contentType !== "string") return undefined;
    return {
      id: value.id,
      status: value.status,
      ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
      ...(typeof value.body === "string" ? { body: value.body } : {}),
    };
  } catch {
    return undefined;
  }
}

export function secretMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startPhoneRelayFromEnv(): ReturnType<typeof createServer> {
  const host = process.env.OUR_HOME_RELAY_HOST ?? "127.0.0.1";
  const port = Number(process.env.OUR_HOME_RELAY_PORT ?? "8790");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("OUR_HOME_RELAY_PORT must be a valid TCP port");

  const relay = new PhoneRelay({
    phoneToken: process.env.OUR_HOME_RELAY_TUNNEL_TOKEN ?? "",
    mcpToken: process.env.OUR_HOME_RELAY_MCP_TOKEN ?? "",
    defaultDeviceId: process.env.OUR_HOME_RELAY_DEVICE_ID,
    requestTimeoutMs: Number(process.env.OUR_HOME_RELAY_REQUEST_TIMEOUT_MS ?? String(DEFAULT_REQUEST_TIMEOUT_MS)),
    maxInFlight: Number(process.env.OUR_HOME_RELAY_MAX_IN_FLIGHT ?? String(DEFAULT_MAX_IN_FLIGHT)),
  });

  const server = createServer((request, response) => void relay.handleHttp(request, response));
  relay.attachUpgrade(server);
  server.listen(port, host, () => {
    process.stderr.write(`[our-home-relay] listening at http://${host}:${port}; phone WSS upgrades on /; Hermes MCP on /mcp\n`);
  });
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry && import.meta.url === entry) startPhoneRelayFromEnv();
