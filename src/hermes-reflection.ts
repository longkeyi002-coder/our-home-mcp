import { z } from "zod";
import type { AiWorldReflectionAdapter, AiWorldReflectionInput } from "./ai-world-reflection.js";

const responsesApiSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    role: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).optional(),
});

export interface HermesReflectionEngineOptions {
  apiUrl: string;
  apiKey: string;
  conversation?: string;
  model?: string;
  timeoutMs?: number;
}

function responsesUrl(apiUrl: string): string {
  const normalized = apiUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/responses")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/responses`;
  return `${normalized}/v1/responses`;
}

function reflectionActivation(input: AiWorldReflectionInput): string {
  return [
    "This is a bounded AI World continuity review activation.",
    "Use only the supplied AI World source, current AI World state, and read-only Soul tendencies.",
    "Do not inspect Earth Life, phone state, user data, web, MCP, external tools, or send any message for this activation.",
    "Do not output hidden reasoning or chain-of-thought. Return only reusable public structured reflection content.",
    "You cannot choose another source record, a review time, a Soul score/delta, an Earth mutation, a notification, or an external action.",
    'Return only {"action":"ignore"} or {"action":"record_reflection","reflection":{"title":"...","summary":"...","conclusion":"optional","openQuestion":"optional"}}.',
    JSON.stringify(input),
  ].join("\n\n");
}

/** Hermes is an optional reflection provider; Runtime remains provider-neutral. */
export class HermesReflectionEngine implements AiWorldReflectionAdapter {
  private readonly endpoint: string;
  private readonly conversation: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: HermesReflectionEngineOptions) {
    this.endpoint = responsesUrl(options.apiUrl);
    this.conversation = options.conversation ?? "our-home-life-runtime";
    this.model = options.model ?? "hermes-agent";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async evaluate(input: AiWorldReflectionInput): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          conversation: this.conversation,
          input: reflectionActivation(input),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error("Hermes reflection request failed");
    }
    if (!response.ok) throw new Error(`Hermes reflection request returned HTTP ${response.status}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Hermes reflection response was not valid JSON");
    }
    const parsed = responsesApiSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Hermes reflection response had no assistant output_text");
    const outputText = parsed.data.output
      ?.filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("")
      .trim();
    if (!outputText) throw new Error("Hermes reflection response had no assistant output_text");

    try {
      return JSON.parse(outputText);
    } catch {
      throw new Error("Hermes reflection output_text was not bounded reflection JSON");
    }
  }
}
