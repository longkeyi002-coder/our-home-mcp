import type { JsonStore } from "./store.js";
import type { AiWorldSnapshot } from "./types.js";
import {
  advanceAiWorldData,
  assertValidAiWorldData,
  createAiWorldData,
  snapshotAiWorld,
} from "./ai-world.js";

/**
 * OH-P3 persistence adapter. It deliberately avoids a store mutation when the deterministic
 * phase has not changed, so frequent Runtime cycles do not create AI World write churn.
 */
export async function advancePersistedAiWorld(
  store: JsonStore,
  asOf: string,
  initialTimezone: string,
): Promise<AiWorldSnapshot> {
  const before = store.snapshot().aiWorld;
  if (before) {
    assertValidAiWorldData(before);
    const preview = advanceAiWorldData(before, asOf);
    if (!preview.changed) return snapshotAiWorld(before, asOf);
  }

  let result = before ? advanceAiWorldData(before, asOf).data : createAiWorldData(asOf, initialTimezone);
  const updated = await store.update((data) => {
    if (!data.aiWorld) {
      data.aiWorld = createAiWorldData(asOf, initialTimezone);
      result = data.aiWorld;
      return;
    }
    assertValidAiWorldData(data.aiWorld);
    const advanced = advanceAiWorldData(data.aiWorld, asOf);
    if (advanced.changed) data.aiWorld = advanced.data;
    result = data.aiWorld;
  });
  const persisted = updated.aiWorld ?? result;
  return snapshotAiWorld(persisted, asOf);
}

export function readPersistedAiWorld(
  store: JsonStore,
  asOf: string,
): AiWorldSnapshot | undefined {
  const data = store.snapshot().aiWorld;
  if (!data) return undefined;
  assertValidAiWorldData(data);
  return snapshotAiWorld(data, asOf);
}
