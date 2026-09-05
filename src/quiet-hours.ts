import type { WakeEventPriority } from "./types.js";

export interface QuietHoursPolicy {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezone: string;
  weekdays: number[];
  allowHighPriority: boolean;
}

export interface QuietHoursDecision {
  defer: boolean;
  reason: "disabled" | "outside_quiet_hours" | "high_priority_bypass" | "quiet_hours";
  nextAvailableAt?: string;
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;
const MAX_QUIET_SEARCH_MS = 36 * 60 * 60_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function parseLocalMinutes(value: string): number {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid quiet-hours local time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new Error(`Invalid quiet-hours timezone: ${timezone}`);
  }
}

function parseWeekdays(value: string | undefined): number[] {
  if (!value?.trim()) return [0, 1, 2, 3, 4, 5, 6];
  const parsed = [...new Set(value.split(",").map((item) => Number(item.trim())))].sort((a, b) => a - b);
  if (!parsed.length || parsed.some((item) => !Number.isInteger(item) || item < 0 || item > 6)) {
    throw new Error("OUR_HOME_QUIET_HOURS_WEEKDAYS must be comma-separated integers from 0 to 6");
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("Quiet-hours boolean settings must be true or false");
}

export function quietHoursPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): QuietHoursPolicy {
  const startLocal = env.OUR_HOME_QUIET_HOURS_START?.trim();
  const endLocal = env.OUR_HOME_QUIET_HOURS_END?.trim();
  const timezone = env.OUR_HOME_QUIET_HOURS_TIMEZONE?.trim();

  if (!startLocal && !endLocal && !timezone) {
    return {
      enabled: false,
      startLocal: "00:00",
      endLocal: "00:01",
      timezone: "UTC",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      allowHighPriority: true,
    };
  }
  if (!startLocal || !endLocal || !timezone) {
    throw new Error(
      "Quiet hours require OUR_HOME_QUIET_HOURS_START, OUR_HOME_QUIET_HOURS_END, and OUR_HOME_QUIET_HOURS_TIMEZONE together",
    );
  }

  const startMinutes = parseLocalMinutes(startLocal);
  const endMinutes = parseLocalMinutes(endLocal);
  if (startMinutes === endMinutes) {
    throw new Error("Quiet-hours start and end must differ");
  }
  validateTimezone(timezone);

  return {
    enabled: true,
    startLocal,
    endLocal,
    timezone,
    weekdays: parseWeekdays(env.OUR_HOME_QUIET_HOURS_WEEKDAYS),
    allowHighPriority: parseBoolean(env.OUR_HOME_QUIET_HOURS_ALLOW_HIGH_PRIORITY, true),
  };
}

interface LocalClock {
  weekday: number;
  minuteOfDay: number;
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

function localClock(atMs: number, timezone: string): LocalClock {
  const parts = formatterFor(timezone).formatToParts(atMs);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const weekdayName = value("weekday");
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayName ? weekdays[weekdayName] : undefined;
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Unable to evaluate quiet-hours local time");
  }
  return { weekday, minuteOfDay: hour * 60 + minute };
}

function quietAt(policy: QuietHoursPolicy, atMs: number): boolean {
  if (!policy.enabled) return false;
  const local = localClock(atMs, policy.timezone);
  const start = parseLocalMinutes(policy.startLocal);
  const end = parseLocalMinutes(policy.endLocal);
  const enabledDays = new Set(policy.weekdays);

  if (start < end) {
    return enabledDays.has(local.weekday)
      && local.minuteOfDay >= start
      && local.minuteOfDay < end;
  }

  // Overnight window. Example: Monday 23:00 -> Tuesday 07:00. The after-midnight
  // portion belongs to the previous local weekday so weekday selection remains intuitive.
  if (local.minuteOfDay >= start) return enabledDays.has(local.weekday);
  if (local.minuteOfDay < end) return enabledDays.has((local.weekday + 6) % 7);
  return false;
}

function nextQuietEnd(policy: QuietHoursPolicy, asOfMs: number): string | undefined {
  // Search on absolute minute boundaries so a worker cycle at 23:30:37 defers to 07:00:00,
  // not 07:00:37. Evaluating local time through Intl keeps DST and timezone rules authoritative.
  const firstMinuteBoundary = Math.floor(asOfMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let candidate = firstMinuteBoundary; candidate - asOfMs <= MAX_QUIET_SEARCH_MS; candidate += MINUTE_MS) {
    if (!quietAt(policy, candidate)) return new Date(candidate).toISOString();
  }
  return undefined;
}

/**
 * OH-40/OH-47: deterministic final notification gate. Brain can decide that a message is
 * worthwhile, but it cannot bypass a configured quiet window. High-priority wake events may
 * bypass only when the deployment explicitly allows that behavior.
 */
export function decideQuietHours(
  policy: QuietHoursPolicy,
  observedAt: string,
  priority: WakeEventPriority = "normal",
): QuietHoursDecision {
  if (!policy.enabled) return { defer: false, reason: "disabled" };
  const asOfMs = Date.parse(observedAt);
  if (!Number.isFinite(asOfMs)) {
    throw new Error(`Invalid quiet-hours observation time: ${observedAt}`);
  }
  if (!quietAt(policy, asOfMs)) return { defer: false, reason: "outside_quiet_hours" };
  if (priority === "high" && policy.allowHighPriority) {
    return { defer: false, reason: "high_priority_bypass" };
  }

  const nextAvailableAt = nextQuietEnd(policy, asOfMs);
  if (!nextAvailableAt) throw new Error("Unable to determine quiet-hours end within 36 hours");
  return { defer: true, reason: "quiet_hours", nextAvailableAt };
}
