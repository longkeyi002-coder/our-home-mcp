import type { LifeObservation, ObservationConfidence, ObservationProvenance, ObservationSource, ObservationWorld } from "./types.js";

export const OBSERVATION_WORLDS = ["EARTH", "AI_WORLD", "FICTION"] as const;
export const OBSERVATION_PROVENANCES = [
  "observed",
  "user_declared",
  "inferred",
  "simulated",
  "authored",
  "model_generated",
  "legacy_unclassified",
] as const;

export function isValidWorldProvenance(world: ObservationWorld, provenance: ObservationProvenance): boolean {
  if (!(OBSERVATION_WORLDS as readonly unknown[]).includes(world)
    || !(OBSERVATION_PROVENANCES as readonly unknown[]).includes(provenance)) return false;
  if (provenance === "legacy_unclassified" || provenance === "inferred") return true;
  if (world === "EARTH") return provenance === "observed" || provenance === "user_declared";
  return provenance === "simulated" || provenance === "authored" || provenance === "model_generated";
}

export function isEarthEvidence(item: LifeObservation): boolean {
  return item.world === "EARTH"
    && item.source !== "mock"
    && ((item.provenance === "observed" && item.confidence === "observed")
      || (item.provenance === "user_declared" && item.source === "user" && item.confidence === "declared"));
}

export function resolveObservationBoundary(input: {
  source: ObservationSource;
  confidence: ObservationConfidence;
  world?: ObservationWorld;
  provenance?: ObservationProvenance;
}): { world: ObservationWorld; provenance: ObservationProvenance } {
  if ((input.world === undefined) !== (input.provenance === undefined)) {
    throw new Error("world and provenance must be provided together");
  }
  if (input.world !== undefined && input.provenance !== undefined) {
    if (!isValidWorldProvenance(input.world, input.provenance)) {
      throw new Error(`Illegal world/provenance combination: ${input.world}/${input.provenance}`);
    }
    if (input.world === "EARTH" && input.provenance !== "legacy_unclassified") {
      const expected = input.provenance === "observed" ? "observed"
        : input.provenance === "user_declared" ? "declared" : "inferred";
      if (input.source === "mock" || input.confidence !== expected
        || (input.provenance === "user_declared" && input.source !== "user")) {
        throw new Error("Observation source/confidence contradicts Earth provenance");
      }
    }
    return { world: input.world, provenance: input.provenance };
  }

  // Deterministic v2 migration/defaults. Ambiguous legacy records are explicitly
  // quarantined as legacy_unclassified and cannot satisfy Earth evidence queries.
  if (input.source === "mock") return { world: "FICTION", provenance: "legacy_unclassified" };
  if (input.confidence === "inferred") return { world: "EARTH", provenance: "inferred" };
  if (input.source === "user" && input.confidence === "declared") {
    return { world: "EARTH", provenance: "user_declared" };
  }
  if (
    input.confidence === "observed"
    && (input.source === "phone" || input.source === "screen" || input.source === "calendar")
  ) {
    return { world: "EARTH", provenance: "observed" };
  }
  return { world: "EARTH", provenance: "legacy_unclassified" };
}

export function assertValidObservationBoundary(item: LifeObservation): void {
  if (item.world === undefined || item.provenance === undefined) {
    throw new Error("Persisted observations require world and provenance");
  }
  resolveObservationBoundary(item);
}
