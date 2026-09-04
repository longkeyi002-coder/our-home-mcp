import type { LifeContext, WakeDecision, WakeEvent } from "./types.js";

/**
 * Provider-neutral boundary between the Life Runtime and the currently selected AI.
 *
 * Runtime owns sensing, state, wake events, persistence and delivery. A BrainAdapter
 * only receives a bounded wake context and returns a structured decision.
 */
export interface BrainAdapter {
  evaluate(input: BrainInput): Promise<WakeDecision>;
}

export interface BrainInput {
  wakeEvent: WakeEvent;
  context: LifeContext;
}

/** Backward-compatible name while older code/tests are migrated. */
export type LifeDecisionEngine = BrainAdapter;
