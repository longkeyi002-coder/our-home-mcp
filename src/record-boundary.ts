import type { ObservationProvenance as RecordProvenance, ObservationWorld as RecordWorld } from "./types.js";

export type { RecordProvenance, RecordWorld };

const NEW_RECORD_PROVENANCES = [
  "observed",
  "user_declared",
  "inferred",
  "simulated",
  "authored",
  "model_generated",
] as const satisfies readonly RecordProvenance[];

/**
 * OH-30/OH-31/OH-32: long-lived non-observation records carry an explicit world/provenance
 * boundary too, but their legal pairs are not identical to evidence observations. An Earth
 * action or diary can be authored/model-generated without becoming observed evidence.
 */
export function isValidRecordBoundary(world: RecordWorld, provenance: RecordProvenance): boolean {
  if (!NEW_RECORD_PROVENANCES.includes(provenance as (typeof NEW_RECORD_PROVENANCES)[number])) return false;

  if (world === "EARTH") {
    return provenance === "observed"
      || provenance === "user_declared"
      || provenance === "inferred"
      || provenance === "authored"
      || provenance === "model_generated";
  }
  if (world === "AI_WORLD") {
    return provenance === "inferred"
      || provenance === "simulated"
      || provenance === "authored"
      || provenance === "model_generated";
  }
  if (world === "FICTION") {
    return provenance === "simulated"
      || provenance === "authored"
      || provenance === "model_generated";
  }
  return false;
}

export function assertValidRecordBoundary(input: {
  world: RecordWorld;
  provenance: RecordProvenance;
}): void {
  if (!isValidRecordBoundary(input.world, input.provenance)) {
    throw new Error(`Illegal long-lived record boundary: ${input.world}/${input.provenance}`);
  }
}

/**
 * Compatibility for internal pre-boundary callers only. Missing world+provenance together is
 * quarantined as FICTION/authored rather than guessed into Earth. Public MCP write surfaces
 * require both fields explicitly. Supplying only one boundary half is always an error.
 */
export function resolveRecordBoundary(input: {
  world?: RecordWorld;
  provenance?: RecordProvenance;
}): { world: RecordWorld; provenance: RecordProvenance } {
  if ((input.world === undefined) !== (input.provenance === undefined)) {
    throw new Error("world and provenance must be provided together for long-lived records");
  }
  const boundary = input.world === undefined
    ? { world: "FICTION" as const, provenance: "authored" as const }
    : { world: input.world, provenance: input.provenance! };
  assertValidRecordBoundary(boundary);
  return boundary;
}
