import type {
  AiWorldActivity,
  AiWorldData,
  AiWorldHistoryEvent,
  AiWorldItemKind,
  AiWorldItemProvenance,
  AiWorldItemStatus,
  AiWorldNoteKind,
  AiWorldRoom,
  AiWorldSnapshot,
  AiWorldState,
  AiWorldThoughtThreadStatus,
  AiWorldWeather,
  AiWorldWorkState,
} from "./types.js";

const MAX_HISTORY = 500;
const MAX_PREFERENCE_EVIDENCE_IDS = 100;
const CONTINUITY_PROVENANCES = new Set<AiWorldItemProvenance>(["inferred", "simulated", "authored", "model_generated"]);
const INTEREST_EVIDENCE_DIRECTIONS = new Set(["support", "counter"] as const);

interface LocalClock {
  date: string;
  hour: number;
}

interface PhaseDescriptor {
  phaseKey: string;
  room: AiWorldRoom;
  weather: AiWorldWeather;
  workState: AiWorldWorkState;
  currentActivity: AiWorldActivity;
}

function assertTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid AI World timestamp: ${value}`);
  return parsed;
}

function assertOptionalReviewAt(nextReviewAt: string | undefined, createdAt: string): void {
  if (nextReviewAt === undefined) return;
  if (assertTimestamp(nextReviewAt) < assertTimestamp(createdAt)) {
    throw new Error("AI World nextReviewAt cannot precede record creation");
  }
}

function assertEvidenceRefs(evidenceRefs: string[] | undefined): void {
  if (evidenceRefs === undefined) return;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length > 50) {
    throw new Error("AI World evidenceRefs must be a bounded array");
  }
  for (const ref of evidenceRefs) {
    if (typeof ref !== "string" || !ref.trim() || ref.length > 500) {
      throw new Error("AI World evidenceRefs contains an invalid reference");
    }
  }
}

function assertContinuityBoundary(record: {
  world: string;
  provenance: AiWorldItemProvenance;
  source: string;
}): void {
  if (record.world !== "AI_WORLD" || record.source !== "AGENT_LIFE" || !CONTINUITY_PROVENANCES.has(record.provenance)) {
    throw new Error("AI World continuity record has an invalid world boundary");
  }
}

export function assertAiWorldTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new Error(`Invalid AI World timezone: ${timezone}`);
  }
}

export function aiWorldTimezoneFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const timezone = env.OUR_HOME_AI_WORLD_TIMEZONE?.trim() || "UTC";
  assertAiWorldTimezone(timezone);
  return timezone;
}

function localClock(at: string, timezone: string): LocalClock {
  assertTimestamp(at);
  assertAiWorldTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = Number(value("hour"));
  if (!year || !month || !day || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Unable to derive AI World local clock");
  }
  return { date: `${year}-${month}-${day}`, hour };
}

function weatherForDate(date: string): AiWorldWeather {
  // A deterministic virtual-weather cycle. It is an AI World fact, never Earth weather.
  let hash = 0;
  for (const char of date) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const bucket = hash % 6;
  if (bucket === 0) return "rain";
  if (bucket <= 2) return "cloudy";
  return "clear";
}

function phaseFor(at: string, timezone: string): PhaseDescriptor {
  const local = localClock(at, timezone);
  const weather = weatherForDate(local.date);

  let room: AiWorldRoom;
  let workState: AiWorldWorkState;
  let currentActivity: AiWorldActivity;

  if (local.hour < 6) {
    room = "bedroom";
    workState = "resting";
    currentActivity = "sleeping";
  } else if (local.hour < 9) {
    room = "kitchen";
    workState = "preparing";
    currentActivity = "morning_routine";
  } else if (local.hour < 12) {
    room = "study";
    workState = "working";
    currentActivity = "focused_work";
  } else if (local.hour < 13) {
    room = "kitchen";
    workState = "off_duty";
    currentActivity = "midday_break";
  } else if (local.hour < 18) {
    room = "study";
    workState = "working";
    currentActivity = "focused_work";
  } else if (local.hour < 22) {
    room = "living_room";
    workState = "off_duty";
    currentActivity = "free_time";
  } else {
    room = "bedroom";
    workState = "resting";
    currentActivity = "winding_down";
  }

  return {
    phaseKey: `${local.date}:${currentActivity}`,
    room,
    weather,
    workState,
    currentActivity,
  };
}

function initialHistory(state: AiWorldState): AiWorldHistoryEvent {
  return {
    id: `ai-world:init:${state.updatedAt}`,
    world: "AI_WORLD",
    provenance: "simulated",
    kind: "initialized",
    occurredAt: state.updatedAt,
    toPhaseKey: state.phaseKey,
    changes: {
      location: state.location,
      room: state.room,
      weather: state.weather,
      workState: state.workState,
      currentActivity: state.currentActivity,
    },
  };
}

export function createAiWorldData(asOf: string, timezone: string): AiWorldData {
  assertTimestamp(asOf);
  assertAiWorldTimezone(timezone);
  const phase = phaseFor(asOf, timezone);
  const state: AiWorldState = {
    world: "AI_WORLD",
    provenance: "simulated",
    timezone,
    home: "our_home",
    location: "our_home",
    ...phase,
    lastTransitionAt: asOf,
    updatedAt: asOf,
  };
  return {
    state,
    history: [initialHistory(state)],
    items: [],
    continuity: { experiences: [], notes: [], thoughtThreads: [], interestEvidence: [], preferences: [] },
  };
}

export function assertValidAiWorldData(data: AiWorldData): void {
  if (!data || typeof data !== "object" || !data.state || !Array.isArray(data.history)) {
    throw new Error("Invalid persisted AI World data");
  }
  const state = data.state;
  if (
    state.world !== "AI_WORLD"
    || state.provenance !== "simulated"
    || state.home !== "our_home"
    || state.location !== "our_home"
  ) {
    throw new Error("AI World state has an invalid world boundary");
  }
  assertAiWorldTimezone(state.timezone);
  assertTimestamp(state.lastTransitionAt);
  assertTimestamp(state.updatedAt);

  const rooms = new Set<AiWorldRoom>(["bedroom", "study", "living_room", "kitchen"]);
  const weather = new Set<AiWorldWeather>(["clear", "cloudy", "rain"]);
  const workStates = new Set<AiWorldWorkState>(["resting", "preparing", "working", "off_duty"]);
  const activities = new Set<AiWorldActivity>([
    "sleeping",
    "morning_routine",
    "focused_work",
    "midday_break",
    "free_time",
    "winding_down",
  ]);
  if (!rooms.has(state.room) || !weather.has(state.weather)
    || !workStates.has(state.workState) || !activities.has(state.currentActivity)
    || typeof state.phaseKey !== "string" || !state.phaseKey) {
    throw new Error("AI World state contains an invalid deterministic phase");
  }

  for (const event of data.history) {
    if (event.world !== "AI_WORLD" || event.provenance !== "simulated") {
      throw new Error("AI World history has an invalid world boundary");
    }
    if (event.kind !== "initialized" && event.kind !== "state_transition") {
      throw new Error("AI World history has an invalid event kind");
    }
    assertTimestamp(event.occurredAt);
  }

  if (data.items !== undefined) {
    if (!Array.isArray(data.items)) throw new Error("AI World items must be an array");
    const kinds = new Set<AiWorldItemKind>([
      "task",
      "waiting",
      "plan",
      "idea",
      "question",
      "hobby",
      "interest",
      "collection",
    ]);
    const statuses = new Set<AiWorldItemStatus>(["active", "completed", "archived"]);
    const provenances = new Set<AiWorldItemProvenance>(["inferred", "simulated", "authored", "model_generated"]);
    for (const item of data.items) {
      if (item.world !== "AI_WORLD" || item.source !== "AGENT_LIFE" || !provenances.has(item.provenance)) {
        throw new Error("AI World item has an invalid world boundary");
      }
      if (!kinds.has(item.kind) || !statuses.has(item.status) || !item.id || !item.title.trim()) {
        throw new Error("AI World item has invalid structured fields");
      }
      assertTimestamp(item.createdAt);
      assertTimestamp(item.updatedAt);
    }
  }

  if (data.continuity !== undefined) {
    const continuity = data.continuity;
    if (!Array.isArray(continuity.experiences) || !Array.isArray(continuity.notes) || !Array.isArray(continuity.thoughtThreads)) {
      throw new Error("AI World continuity collections must be arrays");
    }

    for (const experience of continuity.experiences) {
      assertContinuityBoundary(experience);
      if (!experience.id || !experience.summary.trim()) throw new Error("AI World experience has invalid structured fields");
      const occurredAt = assertTimestamp(experience.occurredAt);
      const createdAt = assertTimestamp(experience.createdAt);
      if (occurredAt > createdAt) throw new Error("AI World experience cannot occur after creation");
      if (experience.confidence !== undefined && (!Number.isFinite(experience.confidence) || experience.confidence < 0 || experience.confidence > 1)) {
        throw new Error("AI World experience confidence must be between 0 and 1");
      }
      assertEvidenceRefs(experience.evidenceRefs);
      if (experience.lastReviewedAt !== undefined && assertTimestamp(experience.lastReviewedAt) < createdAt) {
        throw new Error("AI World experience lastReviewedAt cannot precede creation");
      }
      assertOptionalReviewAt(experience.nextReviewAt, experience.createdAt);
    }

    const noteKinds = new Set<AiWorldNoteKind>(["note", "journal"]);
    for (const note of continuity.notes) {
      assertContinuityBoundary(note);
      if (!note.id || !noteKinds.has(note.kind) || !note.title.trim() || !note.body.trim()) {
        throw new Error("AI World note has invalid structured fields");
      }
      const createdAt = assertTimestamp(note.createdAt);
      if (assertTimestamp(note.updatedAt) < createdAt) throw new Error("AI World note updatedAt cannot precede creation");
      assertEvidenceRefs(note.evidenceRefs);
      assertOptionalReviewAt(note.nextReviewAt, note.createdAt);
    }

    const threadStatuses = new Set<AiWorldThoughtThreadStatus>(["active", "resolved", "archived"]);
    for (const thread of continuity.thoughtThreads) {
      assertContinuityBoundary(thread);
      if (!thread.id || !thread.title.trim() || !thread.summary.trim() || !threadStatuses.has(thread.status)) {
        throw new Error("AI World thought thread has invalid structured fields");
      }
      const createdAt = assertTimestamp(thread.createdAt);
      if (assertTimestamp(thread.updatedAt) < createdAt) throw new Error("AI World thought thread updatedAt cannot precede creation");
      assertEvidenceRefs(thread.evidenceRefs);
      assertOptionalReviewAt(thread.nextReviewAt, thread.createdAt);
    }

    const interestEvidence = continuity.interestEvidence ?? [];
    if (!Array.isArray(interestEvidence)) throw new Error("AI World interestEvidence must be an array");
    const evidenceKeys = new Set<string>();
    const evidenceById = new Map<string, (typeof interestEvidence)[number]>();
    for (const evidence of interestEvidence) {
      assertContinuityBoundary(evidence);
      if (!evidence.id || !evidence.interestKey.trim() || !evidence.evidenceKey.trim()
        || !INTEREST_EVIDENCE_DIRECTIONS.has(evidence.direction) || !evidence.reason.trim()) {
        throw new Error("AI World interest evidence has invalid structured fields");
      }
      if (!Number.isFinite(evidence.strength) || evidence.strength < 0 || evidence.strength > 1) {
        throw new Error("AI World interest evidence strength must be between 0 and 1");
      }
      if (assertTimestamp(evidence.occurredAt) > assertTimestamp(evidence.createdAt)) {
        throw new Error("AI World interest evidence cannot occur after creation");
      }
      assertEvidenceRefs(evidence.evidenceRefs);
      const compositeKey = `${evidence.interestKey}\u0000${evidence.evidenceKey}`;
      if (evidenceKeys.has(compositeKey)) throw new Error("Duplicate AI World interest evidence key");
      if (evidenceById.has(evidence.id)) throw new Error("Duplicate AI World interest evidence id");
      evidenceKeys.add(compositeKey);
      evidenceById.set(evidence.id, evidence);
    }

    const preferences = continuity.preferences ?? [];
    if (!Array.isArray(preferences)) throw new Error("AI World preferences must be an array");
    const preferenceKeys = new Set<string>();
    for (const preference of preferences) {
      if (preference.world !== "AI_WORLD" || preference.provenance !== "inferred" || preference.source !== "AGENT_LIFE") {
        throw new Error("AI World preference has an invalid world boundary");
      }
      if (!preference.id || !preference.interestKey.trim() || !Number.isFinite(preference.score)
        || preference.score < -1 || preference.score > 1) {
        throw new Error("AI World preference has invalid structured fields");
      }
      if (!Number.isInteger(preference.evidenceCount) || preference.evidenceCount < 1) {
        throw new Error("AI World preference evidenceCount must be positive");
      }
      if (!Array.isArray(preference.evidenceIds) || preference.evidenceIds.length > MAX_PREFERENCE_EVIDENCE_IDS
        || preference.evidenceIds.some((id) => typeof id !== "string" || !id)) {
        throw new Error("AI World preference evidence trace is invalid");
      }
      const evidenceForPreference = interestEvidence.filter((item) => item.interestKey === preference.interestKey);
      if (evidenceForPreference.length !== preference.evidenceCount) {
        throw new Error("AI World preference evidenceCount does not match evidence");
      }
      for (const evidenceId of preference.evidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence || evidence.interestKey !== preference.interestKey) {
          throw new Error("AI World preference evidence trace references unrelated evidence");
        }
      }
      const lastEvidenceAt = assertTimestamp(preference.lastEvidenceAt);
      const lastEvaluatedAt = assertTimestamp(preference.lastEvaluatedAt);
      const createdAt = assertTimestamp(preference.createdAt);
      if (assertTimestamp(preference.updatedAt) < createdAt || lastEvaluatedAt < createdAt || lastEvidenceAt > lastEvaluatedAt) {
        throw new Error("AI World preference timestamps are inconsistent");
      }
      if (preference.nextReviewAt !== undefined && assertTimestamp(preference.nextReviewAt) < lastEvaluatedAt) {
        throw new Error("AI World preference nextReviewAt cannot precede last evaluation");
      }
      if (preferenceKeys.has(preference.interestKey)) throw new Error("Duplicate AI World preference state");
      preferenceKeys.add(preference.interestKey);
    }
  }
}

export function advanceAiWorldData(
  current: AiWorldData,
  asOf: string,
): { data: AiWorldData; changed: boolean } {
  assertValidAiWorldData(current);
  const asOfMs = assertTimestamp(asOf);
  const updatedAtMs = assertTimestamp(current.state.updatedAt);
  if (asOfMs <= updatedAtMs) return { data: structuredClone(current), changed: false };

  const nextPhase = phaseFor(asOf, current.state.timezone);
  const previous = current.state;
  const changes: AiWorldHistoryEvent["changes"] = {};
  if (previous.room !== nextPhase.room) changes.room = nextPhase.room;
  if (previous.weather !== nextPhase.weather) changes.weather = nextPhase.weather;
  if (previous.workState !== nextPhase.workState) changes.workState = nextPhase.workState;
  if (previous.currentActivity !== nextPhase.currentActivity) changes.currentActivity = nextPhase.currentActivity;

  if (previous.phaseKey === nextPhase.phaseKey && Object.keys(changes).length === 0) {
    return { data: structuredClone(current), changed: false };
  }

  const state: AiWorldState = {
    ...previous,
    ...nextPhase,
    lastTransitionAt: asOf,
    updatedAt: asOf,
  };
  const event: AiWorldHistoryEvent = {
    id: `ai-world:transition:${previous.phaseKey}->${state.phaseKey}:${asOf}`,
    world: "AI_WORLD",
    provenance: "simulated",
    kind: "state_transition",
    occurredAt: asOf,
    fromPhaseKey: previous.phaseKey,
    toPhaseKey: state.phaseKey,
    changes,
  };
  return {
    changed: true,
    data: {
      state,
      history: [event, ...current.history].slice(0, MAX_HISTORY),
      items: current.items ?? [],
      continuity: current.continuity,
    },
  };
}

export function snapshotAiWorld(data: AiWorldData, clockAt: string): AiWorldSnapshot {
  assertValidAiWorldData(data);
  assertTimestamp(clockAt);
  return {
    clockAt,
    state: structuredClone(data.state),
    recentHistory: structuredClone(data.history.slice(0, 50)),
  };
}
