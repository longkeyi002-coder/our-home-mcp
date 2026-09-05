import type {
  AiWorldActivity,
  AiWorldData,
  AiWorldHistoryEvent,
  AiWorldRoom,
  AiWorldSnapshot,
  AiWorldState,
  AiWorldWeather,
  AiWorldWorkState,
} from "./types.js";

const MAX_HISTORY = 500;

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
    ...phase,
    lastTransitionAt: asOf,
    updatedAt: asOf,
  };
  return { state, history: [initialHistory(state)] };
}

export function assertValidAiWorldData(data: AiWorldData): void {
  if (!data || typeof data !== "object" || !data.state || !Array.isArray(data.history)) {
    throw new Error("Invalid persisted AI World data");
  }
  const state = data.state;
  if (state.world !== "AI_WORLD" || state.provenance !== "simulated" || state.home !== "our_home") {
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
