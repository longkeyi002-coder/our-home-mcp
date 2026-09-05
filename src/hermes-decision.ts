import { z } from "zod";
import type { BrainAdapter } from "./brain.js";
import type { LifeContext, WakeDecision, WakeEvent } from "./types.js";

const wakeDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore") }).strict(),
  z.object({
    action: z.literal("request_visual"),
    reason: z.string().trim().min(1).max(1_000),
  }).strict(),
  z.object({
    action: z.literal("proactive_message"),
    candidate: z.object({
      title: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(5_000),
      reason: z.string().trim().min(1).max(1_000),
      dueAt: z.string().datetime({ offset: true }).optional(),
      dedupeKey: z.string().trim().max(500).optional(),
    }).strict(),
  }).strict(),
]);

const responsesApiSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    role: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).optional(),
});

export interface HermesDecisionEngineOptions {
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

function decisionContract(wakeEvent: WakeEvent): string {
  if (wakeEvent.type === "visual_opportunity") {
    return [
      "This wake event is only asking whether one already-eligible visual observation is worth requesting now.",
      "You may not choose another app, session, or privacy policy. Android local guards remain authoritative and may still refuse capture.",
      'Return only {"action":"ignore"} or {"action":"request_visual","reason":"..."}.',
    ].join("\n");
  }
  return [
    "This wake event is a Care decision, not a visual-observation decision.",
    'Return only {"action":"ignore"} or {"action":"proactive_message","candidate":{"title":"...","message":"...","reason":"...","dueAt":"optional ISO datetime","dedupeKey":"optional"}}.',
  ].join("\n");
}

function activationInput(wakeEvent: WakeEvent, context: LifeContext): string {
  return [
    "This is an AI Life Runtime wake activation delivered through the Hermes brain adapter.",
    "Evaluate the wake event using your existing tools, memory, and MCP access as needed.",
    "Return only one WakeDecision V0.2 JSON object, with no Markdown or commentary.",
    decisionContract(wakeEvent),
    JSON.stringify({
      wakeEvent: {
        id: wakeEvent.id,
        type: wakeEvent.type,
        reason: wakeEvent.reason,
        observedAt: wakeEvent.observedAt,
        lifeState: wakeEvent.lifeState,
        previousLifeState: wakeEvent.previousLifeState,
        visualContext: wakeEvent.visualContext,
      },
      context,
    }),
  ].join("\n\n");
}

/** Hermes is one optional BrainAdapter, not a Runtime dependency. */
export class HermesDecisionEngine implements BrainAdapter {
  readonly conversation: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: HermesDecisionEngineOptions) {
    this.endpoint = responsesUrl(options.apiUrl);
    this.conversation = options.conversation ?? "our-home-life-runtime";
    this.model = options.model ?? "hermes-agent";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async evaluate(input: { wakeEvent: WakeEvent; context: LifeContext }): Promise<WakeDecision> {
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
          input: activationInput(input.wakeEvent, input.context),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error("Hermes decision request failed");
    }

    if (!response.ok) throw new Error(`Hermes decision request returned HTTP ${response.status}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Hermes response was not valid JSON");
    }
    const responseResult = responsesApiSchema.safeParse(payload);
    if (!responseResult.success) throw new Error("Hermes response had no assistant output_text");
    const outputText = responseResult.data.output
      ?.filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("")
      .trim();
    if (!outputText) throw new Error("Hermes response had no assistant output_text");

    let decision: unknown;
    try {
      decision = JSON.parse(outputText);
    } catch {
      throw new Error("Hermes output_text was not WakeDecision JSON");
    }
    const decisionResult = wakeDecisionSchema.safeParse(decision);
    if (!decisionResult.success) throw new Error("Hermes output_text violated the WakeDecision contract");
    if (input.wakeEvent.type === "visual_opportunity" && decisionResult.data.action === "proactive_message") {
      throw new Error("Visual opportunity cannot directly create a proactive message");
    }
    if (input.wakeEvent.type !== "visual_opportunity" && decisionResult.data.action === "request_visual") {
      throw new Error("Only a visual opportunity may request visual observation");
    }
    return decisionResult.data;
  }
}
