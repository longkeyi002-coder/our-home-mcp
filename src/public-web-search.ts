import { z } from "zod";
import {
  EXPLORATION_MAX_SOURCES,
  type AiWorldExplorationAdapter,
  type AiWorldExplorationInput,
  type AiWorldExplorationResult,
} from "./ai-world-exploration.js";

const DEFAULT_MAX_RESPONSE_BYTES = 100_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const sourceSchema = z.object({
  url: z.string().trim().min(1).max(2_000).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Search result URL must be HTTP(S) without embedded credentials"),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(2_000),
}).strict();

const gatewayResponseSchema = z.object({
  results: z.array(sourceSchema).max(EXPLORATION_MAX_SOURCES),
}).strict();

export interface PublicWebSearchHttpAdapterOptions {
  endpoint: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

function validateEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public Web search endpoint must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Public Web search endpoint must use HTTP(S)");
  }
  if (url.username || url.password) {
    throw new Error("Public Web search endpoint cannot contain embedded credentials");
  }
  if (url.hash) {
    throw new Error("Public Web search endpoint cannot contain a URL fragment");
  }
  return url;
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

async function readBoundedUtf8(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error("Public Web search response exceeds the configured byte limit");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response too large");
      throw new Error("Public Web search response exceeds the configured byte limit");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/**
 * Concrete P5.2 network adapter for a separately deployed read-only public-search gateway.
 *
 * The Runtime sends GET only, carries no cookie/auth/session headers, follows no redirects,
 * and never fetches arbitrary search-result URLs itself. The gateway therefore remains the
 * network capability boundary until a dedicated SSRF-safe fetch policy exists.
 */
export class PublicWebSearchHttpAdapter implements AiWorldExplorationAdapter {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PublicWebSearchHttpAdapterOptions) {
    this.endpoint = validateEndpoint(options.endpoint);
    this.timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "Public Web search timeoutMs", 1_000, 60_000);
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "Public Web search maxResponseBytes",
      1_024,
      1_000_000,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async explore(input: AiWorldExplorationInput): Promise<AiWorldExplorationResult> {
    if (!input.capability.publicWebOnly || input.capability.authenticatedSessions || input.capability.externalSideEffects) {
      throw new Error("Public Web search adapter requires the read-only exploration capability contract");
    }

    const url = new URL(this.endpoint.toString());
    url.searchParams.set("q", input.topic.text);
    url.searchParams.set("limit", String(Math.min(input.capability.maxSources, EXPLORATION_MAX_SOURCES)));

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Public Web search gateway returned HTTP ${response.status}`);

    const raw = await readBoundedUtf8(response, this.maxResponseBytes);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("Public Web search gateway returned invalid JSON");
    }
    const parsed = gatewayResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("Public Web search gateway violated the bounded result contract");

    if (parsed.data.results.length === 0) return { status: "no_result", sources: [] };
    return {
      status: "completed",
      sources: parsed.data.results,
    };
  }
}
