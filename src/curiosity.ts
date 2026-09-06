import type { ContextUnderstandingState } from "./context-understanding.js";
export type { ContextUnderstandingState } from "./context-understanding.js";

export type CuriosityReason =
  | "screen_unavailable"
  | "dwell_too_short"
  | "visual_cooldown"
  | "unknown_dwell"
  | "partial_dwell"
  | "known_dwell_recheck"
  | "context_conflict"
  | "stale_context";

export interface CuriosityInput {
  understanding: ContextUnderstandingState;
  dwellMs: number;
  screenUsable: boolean;
  nowMs: number;
  lastVisualAtMs?: number | null;
}

export interface CuriosityDecision {
  requestVisual: boolean;
  reason: CuriosityReason;
  thresholdMs?: number;
  nextReviewAtMs?: number;
}

const MINUTE = 60_000;
export const VISUAL_COOLDOWN_MS = 20 * MINUTE;

const THRESHOLD_MS: Record<ContextUnderstandingState, number> = {
  // Give an ordinary active session a chance to reach Brain while the user is still using it.
  // Brain still decides look/ignore, and Android remains the final privacy/session veto.
  UNKNOWN: 5 * MINUTE,
  PARTIAL: 10 * MINUTE,
  // Known context is intentionally less urgent, but can still be rechecked during sustained use.
  KNOWN: 20 * MINUTE,
  // A meaningful contradiction should be reviewed sooner, still without calling a model loop.
  CONFLICT: 5 * MINUTE,
  STALE: 10 * MINUTE,
};

const CURIOSITY_REASON: Record<ContextUnderstandingState, CuriosityReason> = {
  UNKNOWN: "unknown_dwell",
  PARTIAL: "partial_dwell",
  KNOWN: "known_dwell_recheck",
  CONFLICT: "context_conflict",
  STALE: "stale_context",
};

/**
 * OH-44/OH-64/OH-65: cheap deterministic policy. This function may create a visual
 * opportunity candidate only. It does not capture a screen, call Vision/Brain, or send a
 * user-facing message. Android Sensitive Guard is still authoritative at capture time.
 */
export function decideCuriosity(input: CuriosityInput): CuriosityDecision {
  const thresholdMs = THRESHOLD_MS[input.understanding];
  if (!input.screenUsable) {
    return { requestVisual: false, reason: "screen_unavailable", thresholdMs };
  }

  if (input.dwellMs < thresholdMs) {
    return {
      requestVisual: false,
      reason: "dwell_too_short",
      thresholdMs,
      nextReviewAtMs: input.nowMs + (thresholdMs - Math.max(0, input.dwellMs)),
    };
  }

  if (input.lastVisualAtMs != null) {
    const sinceVisual = Math.max(0, input.nowMs - input.lastVisualAtMs);
    if (sinceVisual < VISUAL_COOLDOWN_MS) {
      return {
        requestVisual: false,
        reason: "visual_cooldown",
        thresholdMs,
        nextReviewAtMs: input.lastVisualAtMs + VISUAL_COOLDOWN_MS,
      };
    }
  }

  return { requestVisual: true, reason: CURIOSITY_REASON[input.understanding], thresholdMs };
}
