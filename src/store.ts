import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ActionItem,
  ActionStatus,
  Actor,
  HeartbeatRecord,
  LifeContext,
  LifeObservation,
  ObservationConfidence,
  ObservationKind,
  ObservationSource,
  DiaryEntry,
  DiaryVisibility,
  OurHomeData,
  ProactiveCandidate,
  ProactiveCandidateStatus,
  ProactiveMessage,
  PhoneDeviceRegistration,
  RelationshipEvent,
  RoutineWindow,
  WakeEngineState,
  WakeEvent,
  WakeEventStatus,
  WakeDecision,
  ObservationProvenance,
  ObservationWorld,
  VisualRequestRecord,
} from "./types.js";
import { deriveLifeState } from "./life-state.js";
import { deriveWakeEventDrafts } from "./wake-engine.js";
import { assertValidObservationBoundary, resolveObservationBoundary } from "./world-boundary.js";
import { assertValidRecordBoundary, resolveRecordBoundary } from "./record-boundary.js";
import { VISUAL_REQUEST_TTL_MS, type VisualOpportunity } from "./visual-request.js";

const now = () => new Date().toISOString();
export interface StoreFileSystem { writeFile: typeof writeFile }
const defaultFileSystem: StoreFileSystem = { writeFile };

function appendActivity(
  data: OurHomeData,
  input: {
    kind: string;
    title: string;
    summary?: string;
    source: "AGENT_LIFE" | "RELATIONSHIP" | "HOME_STATE";
    world: ObservationWorld;
    provenance: ObservationProvenance;
  },
): void {
  assertValidRecordBoundary(input);
  data.activities.unshift({
    id: randomUUID(),
    ...input,
    occurredAt: now(),
  });
}
 
const USAGE_SUMMARY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function compactUsageSummaryObservations(data: OurHomeData, asOf = Date.now()): void {
  const cutoff = asOf - USAGE_SUMMARY_RETENTION_MS;
  const seenBuckets = new Set<string>();
  data.observations = data.observations.filter((item) => {
    if (item.kind !== "usage_summary") return true;
    const observedAt = Date.parse(item.observedAt);
    if (Number.isFinite(observedAt) && observedAt < cutoff) return false;
    const day = typeof item.metadata?.day === "string" ? item.metadata.day : item.observedAt.slice(0, 10);
    const clientEventId = typeof item.metadata?.clientEventId === "string" ? item.metadata.clientEventId : undefined;
    const clientEventParts = clientEventId?.split(":");
    const bucket = Number.isFinite(observedAt)
      ? String(Math.floor(observedAt / (60 * 60 * 1000)))
      : clientEventId?.startsWith("usage-summary:")
        ? clientEventParts?.[clientEventParts.length - 1] ?? ""
        : item.observedAt;
    const key = JSON.stringify([item.world, item.provenance, item.deviceId, day, bucket]);
    if (seenBuckets.has(key)) return false;
    seenBuckets.add(key);
    return true;
  });
}

function emptyData(): OurHomeData {
  const timestamp = now();
  return {
    schemaVersion: 3,
    diaries: [],
    relationshipEvents: [],
    actions: [],
    activities: [],
    proactiveMessages: [],
    homeState: {
      presence: "unknown",
      updatedAt: timestamp,
      source: "HOME_STATE",
    },
    observations: [],
    routines: [],
    heartbeats: [],
    proactiveQueue: [],
    wakeEvents: [],
    wakeEngineState: emptyWakeEngineState(),
    phoneDeviceRegistrations: [],
    visualRequests: [],
  };
}

function emptyWakeEngineState(): WakeEngineState {
  return { lastLifeState: null, lastEventAt: {} };
}

function seedData(): OurHomeData {
  const timestamp = now();
  return {
    schemaVersion: 3,
    diaries: [
      {
        id: "diary_seed_welcome",
        world: "FICTION",
        provenance: "authored",
        title: "第一份记录",
        body: "这是 Our Home 的本地示例数据。它不是 Hermes 的真实活动，也不是关系事实。",
        author: "agent",
        visibility: "shared",
        source: "AGENT_LIFE",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    relationshipEvents: [],
    actions: [
      {
        id: "action_seed_review",
        world: "FICTION",
        provenance: "authored",
        title: "确认 Our Home 的第一版边界",
        description: "确认哪些数据属于 Hermes，哪些数据属于 Our Home。",
        status: "in_progress",
        createdAt: timestamp,
        updatedAt: timestamp,
        source: "AGENT_LIFE",
      },
    ],
    activities: [
      {
        id: "activity_seed_started",
        world: "FICTION",
        provenance: "simulated",
        kind: "system",
        title: "Our Home MCP 已初始化",
        summary: "当前使用本地 Mock 数据层。",
        occurredAt: timestamp,
        source: "HOME_STATE",
      },
    ],
    proactiveMessages: [],
    homeState: {
      presence: "waiting",
      note: "等待 Hermes 接入。",
      updatedAt: timestamp,
      source: "HOME_STATE",
    },
    observations: [],
    routines: [],
    heartbeats: [],
    proactiveQueue: [],
    wakeEvents: [],
    wakeEngineState: emptyWakeEngineState(),
    phoneDeviceRegistrations: [],
    visualRequests: [],
  };
}

function migratePersistedObservation(value: LifeObservation): LifeObservation {
  const raw = value as LifeObservation & { world?: ObservationWorld; provenance?: ObservationProvenance };
  const boundary = resolveObservationBoundary({
    source: raw.source,
    confidence: raw.confidence,
    world: raw.world,
    provenance: raw.provenance,
  });
  return { ...raw, ...boundary };
}

function migrateData(value: unknown): OurHomeData {
  if (!value || typeof value !== "object") {
    throw new Error("Our Home data file must contain a JSON object");
  }
  const candidate = value as {
    schemaVersion?: unknown;
    diaries?: OurHomeData["diaries"];
    relationshipEvents?: OurHomeData["relationshipEvents"];
    actions?: OurHomeData["actions"];
    activities?: OurHomeData["activities"];
    proactiveMessages?: OurHomeData["proactiveMessages"];
    homeState?: OurHomeData["homeState"];
    observations?: OurHomeData["observations"];
    routines?: OurHomeData["routines"];
    heartbeats?: OurHomeData["heartbeats"];
    proactiveQueue?: OurHomeData["proactiveQueue"];
    wakeEvents?: OurHomeData["wakeEvents"];
    wakeEngineState?: OurHomeData["wakeEngineState"];
    phoneDeviceRegistrations?: OurHomeData["phoneDeviceRegistrations"];
    visualRequests?: OurHomeData["visualRequests"];
  };
  const hasBaseShape =
    Array.isArray(candidate.diaries) &&
    Array.isArray(candidate.relationshipEvents) &&
    Array.isArray(candidate.actions) &&
    Array.isArray(candidate.activities) &&
    Array.isArray(candidate.proactiveMessages) &&
    Boolean(candidate.homeState);
  if (!hasBaseShape) {
    throw new Error("Unsupported or corrupt Our Home data file");
  }
  if (candidate.schemaVersion === 1) {
    return {
      ...(candidate as Omit<OurHomeData, "schemaVersion" | "observations" | "routines" | "heartbeats" | "proactiveQueue">),
      schemaVersion: 3,
      observations: [],
      routines: [],
      heartbeats: [],
      proactiveQueue: [],
      wakeEvents: [],
      wakeEngineState: emptyWakeEngineState(),
      phoneDeviceRegistrations: [],
      visualRequests: [],
    };
  }
  if (
    candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 ||
    !Array.isArray(candidate.observations) ||
    !Array.isArray(candidate.routines) ||
    !Array.isArray(candidate.heartbeats) ||
    !Array.isArray(candidate.proactiveQueue)
  ) {
    throw new Error("Unsupported or corrupt Our Home data file");
  }
  return {
    ...(candidate as OurHomeData),
    schemaVersion: 3,
    observations: candidate.observations.map((item) => {
      if (candidate.schemaVersion === 3) {
        assertValidObservationBoundary(item);
        return item;
      }
      return migratePersistedObservation(item);
    }),
    // RoutineWindow has always represented user-declared Earth routine context. Older
    // records can therefore be normalized without guessing an ambiguous world.
    routines: candidate.routines.map((item) => ({
      ...item,
      world: "EARTH" as const,
      provenance: "user_declared" as const,
    })),
    // Legacy wake snapshots were derived before world filtering. Keep their history,
    // but do not let queued decisions reuse unverified Earth evidence after migration.
    wakeEvents: (candidate.wakeEvents ?? []).map((event) => candidate.schemaVersion === 2 && event.status === "pending"
      ? { ...event, status: "dismissed" as const, processingAt: undefined } : event),
    proactiveQueue: candidate.proactiveQueue.map((entry) => candidate.schemaVersion === 2 && entry.wakeEventId && entry.status === "pending"
      ? { ...entry, status: "dismissed" as const, processingAt: undefined } : entry),
    wakeEngineState: candidate.schemaVersion === 2 ? emptyWakeEngineState() : candidate.wakeEngineState ?? emptyWakeEngineState(),
    phoneDeviceRegistrations: candidate.phoneDeviceRegistrations ?? [],
    // This is a new empty runtime queue, not a migration of historical observations.
    visualRequests: candidate.visualRequests ?? [],
  };
}

export class JsonStore {
  private data: OurHomeData;
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string, data: OurHomeData, private readonly fileSystem: StoreFileSystem) {
    this.data = data;
  }

  static async open(filePath: string, seed = true, fileSystem: StoreFileSystem = defaultFileSystem): Promise<JsonStore> {
    const resolvedPath = resolve(filePath);
    try {
      const raw = await readFile(resolvedPath, "utf8");
      return new JsonStore(resolvedPath, migrateData(JSON.parse(raw)), fileSystem);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const store = new JsonStore(resolvedPath, seed ? seedData() : emptyData(), fileSystem);
      await store.persist(store.data);
      return store;
    }
  }

  snapshot(): OurHomeData {
    return structuredClone(this.data);
  }

  getLifeContext(observedAt = now()): LifeContext {
    const data = this.snapshot();
    const lifeState = deriveLifeState(data.observations, observedAt);
    return {
      observedAt,
      lifeState,
      observations: data.observations.filter(
        (item) => item.world === "EARTH" && item.provenance !== "legacy_unclassified"
          && (!item.expiresAt || item.expiresAt >= observedAt),
      ).slice(0, 50),
      routines: data.routines.filter((item) => item.enabled),
      recentHeartbeats: data.heartbeats.slice(0, 10),
      pendingProactiveMessages: data.proactiveQueue
        .filter((item) => item.status === "pending")
        .slice(0, 20),
      pendingWakeEvents: data.wakeEvents
        .filter((item) => item.status === "pending")
        .slice(0, 20),
    };
  }

  async evaluateWakeEvents(observedAt = now()): Promise<WakeEvent[]> {
    const current = deriveLifeState(this.data.observations, observedAt);
    const previous = this.data.wakeEngineState.lastLifeState;
    if (!previous) {
      await this.update((data) => {
        data.wakeEngineState.lastLifeState = current;
      });
      return [];
    }

    const drafts = deriveWakeEventDrafts(
      previous,
      current,
      observedAt,
      this.data.wakeEngineState.lastEventAt,
    );
    const events: WakeEvent[] = [];
    await this.update((data) => {
      data.wakeEngineState.lastLifeState = current;
      for (const draft of drafts) {
        const duplicate = data.wakeEvents.some(
          (item) => item.status === "pending" && item.dedupeKey === draft.dedupeKey,
        );
        if (duplicate) continue;
        const event: WakeEvent = {
          id: randomUUID(),
          ...draft,
          status: "pending",
          createdAt: observedAt,
          observedAt,
          lifeState: structuredClone(current),
          previousLifeState: structuredClone(previous),
        };
        data.wakeEvents.unshift(event);
        data.wakeEngineState.lastEventAt[draft.type] = observedAt;
        events.push(event);
      }
      data.wakeEvents = data.wakeEvents.slice(0, 200);
    });
    return structuredClone(events);
  }

  /**
   * Converts a deterministic Curiosity eligibility result into one short-lived Brain wake.
   * It deliberately does not create a capture request; only applyWakeDecision(request_visual)
   * can do that. At most one unresolved opportunity is kept for the same foreground session.
   */
  async enqueueVisualOpportunity(opportunity: VisualOpportunity): Promise<WakeEvent> {
    const current = deriveLifeState(this.data.observations, opportunity.observedAt);
    const previous = this.data.wakeEngineState.lastLifeState ?? current;
    let result: WakeEvent | undefined;
    await this.update((data) => {
      const existing = data.wakeEvents.find((item) =>
        item.type === "visual_opportunity"
        && item.status === "pending"
        && item.visualContext?.sessionId === opportunity.sessionId,
      );
      if (existing && existing.visualContext!.expiresAt > opportunity.observedAt) {
        result = existing;
        return;
      }
      if (existing) existing.status = "dismissed";
      const event: WakeEvent = {
        id: randomUUID(),
        type: "visual_opportunity",
        status: "pending",
        priority: "low",
        createdAt: opportunity.observedAt,
        observedAt: opportunity.observedAt,
        reason: `Curiosity eligibility gate passed: ${opportunity.curiosityReason}`,
        dedupeKey: `visual_opportunity:${opportunity.sessionId}:${opportunity.observedAt}:${opportunity.curiosityReason}`,
        lifeState: structuredClone(current),
        previousLifeState: structuredClone(previous),
        visualContext: {
          deviceId: opportunity.deviceId,
          packageName: opportunity.packageName,
          sessionId: opportunity.sessionId,
          curiosityReason: opportunity.curiosityReason,
          expiresAt: opportunity.expiresAt,
        },
      };
      data.wakeEvents.unshift(event);
      data.wakeEvents = data.wakeEvents.slice(0, 200);
      result = event;
    });
    if (!result) throw new Error("Visual opportunity was not queued");
    return structuredClone(result);
  }

  hasPendingVisualDecision(deviceId: string, asOf = now()): boolean {
    return this.snapshot().wakeEvents.some((item) =>
      item.type === "visual_opportunity"
      && item.status === "pending"
      && item.visualContext?.deviceId === deviceId
      && item.visualContext.expiresAt > asOf,
    );
  }

  getPendingVisualRequest(deviceId: string, asOf = now()): VisualRequestRecord | undefined {
    return (this.snapshot().visualRequests ?? [])
      .filter((item) => item.status === "pending" && item.deviceId === deviceId && item.expiresAt > asOf)
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt) || left.requestId.localeCompare(right.requestId))[0];
  }

  async resolveWakeEvent(id: string, status: Exclude<WakeEventStatus, "pending">): Promise<WakeEvent> {
    let result: WakeEvent | undefined;
    await this.update((data) => {
      result = data.wakeEvents.find((item) => item.id === id);
      if (!result) throw new Error(`Wake event not found: ${id}`);
      result.status = status;
    });
    if (!result) throw new Error(`Wake event not found: ${id}`);
    return result;
  }

  listWakeEvents(status: WakeEventStatus = "pending", limit = 20): WakeEvent[] {
    return this.snapshot().wakeEvents.filter((item) => item.status === status).slice(0, limit);
  }

  async applyWakeDecision(id: string, decision: WakeDecision, observedAt = now()): Promise<WakeEvent> {
    let result: WakeEvent | undefined;
    await this.update((data) => {
      result = data.wakeEvents.find((item) => item.id === id);
      if (!result) throw new Error(`Wake event not found: ${id}`);
      if (result.status === "handled") return;
      if (result.status !== "pending") throw new Error(`Pending wake event not found: ${id}`);

      if (result.type === "visual_opportunity" && decision.action === "proactive_message") {
        throw new Error("Visual opportunity cannot directly create a proactive message");
      }
      if (result.type !== "visual_opportunity" && decision.action === "request_visual") {
        throw new Error("Only a visual opportunity may request visual observation");
      }

      if (decision.action === "request_visual") {
        const visual = result.visualContext;
        if (!visual || visual.expiresAt <= observedAt) {
          result.status = "dismissed";
          return;
        }
        data.visualRequests ??= [];
        const existing = data.visualRequests.find((item) => item.wakeEventId === id);
        if (!existing) {
          const issuedAtMs = Date.parse(observedAt);
          const opportunityExpiresAtMs = Date.parse(visual.expiresAt);
          const requestExpiresAtMs = Math.min(opportunityExpiresAtMs, issuedAtMs + VISUAL_REQUEST_TTL_MS);
          if (!Number.isFinite(issuedAtMs) || !Number.isFinite(opportunityExpiresAtMs) || requestExpiresAtMs <= issuedAtMs) {
            result.status = "dismissed";
            return;
          }
          data.visualRequests.unshift({
            requestId: `visual-brain:${id}`,
            deviceId: visual.deviceId,
            packageName: visual.packageName,
            sessionId: visual.sessionId,
            reason: decision.reason,
            issuedAt: new Date(issuedAtMs).toISOString(),
            expiresAt: new Date(requestExpiresAtMs).toISOString(),
            status: "pending",
            wakeEventId: id,
          });
          data.visualRequests = data.visualRequests.slice(0, 200);
        }
      }

      if (decision.action === "proactive_message") {
        const existing = data.proactiveQueue.find((item) => item.wakeEventId === id);
        if (!existing) {
          const candidate: ProactiveCandidate = {
            id: randomUUID(), ...decision.candidate,
            dueAt: decision.candidate.dueAt ?? observedAt,
            status: "pending", createdAt: observedAt, attempts: 0,
            source: "AGENT_LIFE", wakeEventId: id,
          };
          data.proactiveQueue.unshift(candidate);
        }
      }
      result.status = "handled";
    });
    if (!result) throw new Error(`Wake event not found: ${id}`);
    return result;
  }

  async update(mutator: (data: OurHomeData) => void): Promise<OurHomeData> {
    let result: OurHomeData | undefined;
    const operation = this.mutationQueue.then(async () => {
      const next = structuredClone(this.data);
      mutator(next);
      await this.persist(next);
      this.data = next;
      result = structuredClone(next);
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
    return result!;
  }

  async registerPhoneDevice(input: {
    deviceId: string;
    appVersion?: string;
    pushFid?: string;
    pushToken?: string;
  }): Promise<PhoneDeviceRegistration> {
    let registration: PhoneDeviceRegistration | undefined;
    await this.update((data) => {
      const existing = data.phoneDeviceRegistrations.find((item) => item.deviceId === input.deviceId);
      const next: PhoneDeviceRegistration = {
        deviceId: input.deviceId,
        ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
        ...(input.pushFid === undefined ? {} : { pushFid: input.pushFid }),
        ...(input.pushToken === undefined ? {} : { pushToken: input.pushToken }),
        updatedAt: now(),
      };
      if (existing) {
        Object.assign(existing, next);
        registration = existing;
      } else {
        data.phoneDeviceRegistrations.push(next);
        registration = next;
      }
    });
    return structuredClone(registration!);
  }

  /** V0.1 targets one primary Companion: the most recently registered token. */
  getPrimaryPushDevice(): PhoneDeviceRegistration | undefined {
    return this.snapshot().phoneDeviceRegistrations
      .filter((item) => Boolean(item.pushToken))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.deviceId.localeCompare(right.deviceId))[0];
  }

  async addDiary(input: {
    title: string;
    body: string;
    author: Actor;
    visibility: DiaryVisibility;
    world?: ObservationWorld;
    provenance?: ObservationProvenance;
  }): Promise<DiaryEntry> {
    const boundary = resolveRecordBoundary(input);
    const timestamp = now();
    const entry: DiaryEntry = {
      id: randomUUID(),
      ...input,
      ...boundary,
      source: input.author === "agent" ? "AGENT_LIFE" : "RELATIONSHIP",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.update((data) => {
      data.diaries.unshift(entry);
      appendActivity(data, {
        kind: "diary_written",
        title: "写入一篇日记",
        summary: entry.title,
        source: entry.source,
        world: entry.world,
        provenance: entry.provenance,
      });
    });
    return entry;
  }

  async addMessage(message: string): Promise<ProactiveMessage> {
    const entry: ProactiveMessage = {
      id: randomUUID(),
      message,
      createdAt: now(),
      source: "AGENT_LIFE",
    };
    await this.update((data) => {
      data.proactiveMessages.unshift(entry);
      appendActivity(data, {
        kind: "proactive_message_left",
        title: "留下主动留言",
        summary: "一条新的 AGENT_LIFE 留言已进入 Our Home。",
        source: "AGENT_LIFE",
        world: "EARTH",
        provenance: "model_generated",
      });
    });
    return entry;
  }

  async recordObservation(input: {
    kind: ObservationKind;
    label: string;
    value?: string;
    observedAt: string;
    source: ObservationSource;
    confidence: ObservationConfidence;
    expiresAt?: string;
    deviceId?: string;
    metadata?: Record<string, string | number | boolean>;
    evidenceRefs?: string[];
    world?: ObservationWorld;
    provenance?: ObservationProvenance;
    clientEventId?: string;
  }): Promise<LifeObservation> {
    const boundary = resolveObservationBoundary(input);
    let result: LifeObservation | undefined;
    await this.update((data) => {
      const clientEventId = input.clientEventId
        ?? (typeof input.metadata?.clientEventId === "string" ? input.metadata.clientEventId : undefined);
      const existing = clientEventId
        ? data.observations.find((item) => item.world === boundary.world && item.provenance === boundary.provenance && item.deviceId === input.deviceId && item.metadata?.clientEventId === clientEventId)
        : undefined;
      if (existing) {
        result = existing;
        return;
      }
      const { clientEventId: _ignoredClientEventId, world: _world, provenance: _provenance, ...observationInput } = input;
      const observation: LifeObservation = {
        ...observationInput,
        id: randomUUID(),
        ...boundary,
        metadata: clientEventId ? { ...(input.metadata ?? {}), clientEventId } : input.metadata,
      };
      data.observations.unshift(observation);
      compactUsageSummaryObservations(data);
      if (observation.kind === "visual_observation_summary") {
        const requestId = typeof observation.metadata?.requestId === "string" ? observation.metadata.requestId : undefined;
        const request = requestId ? (data.visualRequests ?? []).find((item) => item.requestId === requestId) : undefined;
        if (request && request.status === "pending") {
          request.status = "observed";
          request.observedAt = observation.observedAt;
        }
      }
      appendActivity(data, {
        kind: "observation_recorded",
        title: "记录一条生活观察",
        summary: observation.label,
        source: "HOME_STATE",
        world: observation.world,
        provenance: observation.provenance,
      });
      result = observation;
    });
    if (!result) throw new Error("Observation was not recorded");
    return structuredClone(result);
  }

  async addRoutine(input: {
    label: string;
    weekdays: number[];
    startLocal: string;
    endLocal: string;
    timezone: string;
    note?: string;
  }): Promise<RoutineWindow> {
    const timestamp = now();
    const routine: RoutineWindow = {
      id: randomUUID(),
      world: "EARTH",
      provenance: "user_declared",
      ...input,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.update((data) => {
      data.routines.unshift(routine);
      appendActivity(data, {
        kind: "routine_created",
        title: "建立一段生活时间表",
        summary: routine.label,
        source: "HOME_STATE",
        world: routine.world,
        provenance: routine.provenance,
      });
    });
    return routine;
  }

  async recordHeartbeat(summary: string): Promise<HeartbeatRecord> {
    const heartbeat: HeartbeatRecord = {
      id: randomUUID(),
      occurredAt: now(),
      summary,
      source: "system",
    };
    await this.update((data) => {
      data.heartbeats.unshift(heartbeat);
      data.heartbeats = data.heartbeats.slice(0, 200);
    });
    return heartbeat;
  }

  async scheduleProactiveMessage(input: {
    title: string;
    message: string;
    reason: string;
    dueAt: string;
    dedupeKey?: string;
    wakeEventId?: string;
  }): Promise<ProactiveCandidate> {
    let candidate: ProactiveCandidate | undefined;
    await this.update((data) => {
      if (input.dedupeKey) {
        const existing = data.proactiveQueue.find(
          (item) => item.status === "pending" && item.dedupeKey === input.dedupeKey,
        );
        if (existing) {
          candidate = existing;
          return;
        }
      }
      if (input.wakeEventId) {
        const existing = data.proactiveQueue.find((item) => item.wakeEventId === input.wakeEventId);
        if (existing) {
          candidate = existing;
          return;
        }
      }
      candidate = {
        id: randomUUID(), ...input,
        status: "pending", createdAt: now(), attempts: 0, source: "AGENT_LIFE",
      };
      data.proactiveQueue.unshift(candidate);
      appendActivity(data, {
        kind: "proactive_candidate_scheduled",
        title: "安排一条主动消息",
        summary: candidate.title,
        source: "AGENT_LIFE",
        world: "EARTH",
        provenance: "model_generated",
      });
    });
    if (!candidate) throw new Error("Proactive candidate was not created");
    return structuredClone(candidate);
  }

  listDueProactiveMessages(asOf = new Date().toISOString()): ProactiveCandidate[] {
    return this.snapshot().proactiveQueue
      .filter((item) => item.status === "pending" && item.dueAt <= asOf)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async recordProactiveAttempt(id: string, error?: string): Promise<ProactiveCandidate> {
    let result: ProactiveCandidate | undefined;
    await this.update((data) => {
      result = data.proactiveQueue.find((item) => item.id === id);
      if (!result) throw new Error(`Proactive candidate not found: ${id}`);
      result.attempts += 1;
      result.lastAttemptAt = now();
      result.lastError = error;
    });
    if (!result) throw new Error(`Proactive candidate not found: ${id}`);
    return result;
  }

  async resolveProactiveMessage(id: string, status: Exclude<ProactiveCandidateStatus, "pending">): Promise<ProactiveCandidate> {
    let result: ProactiveCandidate | undefined;
    await this.update((data) => {
      result = data.proactiveQueue.find((item) => item.id === id);
      if (!result) throw new Error(`Proactive candidate not found: ${id}`);
      result.status = status;
      if (status === "delivered") result.deliveredAt = now();
      if (status === "dismissed") result.dismissedAt = now();
    });
    if (!result) throw new Error(`Proactive candidate not found: ${id}`);
    return result;
  }

  async addAction(input: {
    title: string;
    description?: string;
    dueAt?: string;
    world?: ObservationWorld;
    provenance?: ObservationProvenance;
  }): Promise<ActionItem> {
    const boundary = resolveRecordBoundary(input);
    const action: ActionItem = {
      id: randomUUID(),
      ...input,
      ...boundary,
      status: "todo",
      createdAt: now(),
      updatedAt: now(),
      source: "AGENT_LIFE",
    };
    await this.update((data) => {
      data.actions.unshift(action);
      appendActivity(data, {
        kind: "action_created",
        title: "创建一项行动",
        summary: action.title,
        source: "AGENT_LIFE",
        world: action.world,
        provenance: action.provenance,
      });
    });
    return action;
  }

  async setActionStatus(id: string, status: ActionStatus): Promise<ActionItem> {
    let result: ActionItem | undefined;
    await this.update((data) => {
      result = data.actions.find((item) => item.id === id);
      if (!result) throw new Error(`Action not found: ${id}`);
      result.status = status;
      result.updatedAt = now();
      appendActivity(data, {
        kind: "action_updated",
        title: "更新行动状态",
        summary: `${result.title} → ${status}`,
        source: "AGENT_LIFE",
        world: result.world,
        provenance: result.provenance,
      });
    });
    if (!result) throw new Error(`Action not found: ${id}`);
    return result;
  }

  async proposeRelationshipEvent(input: {
    title: string;
    description?: string;
    occurredAt: string;
    proposedBy: Actor;
    importance: "ordinary" | "major";
    world?: ObservationWorld;
    provenance?: ObservationProvenance;
  }): Promise<RelationshipEvent> {
    const boundary = resolveRecordBoundary(input);
    const timestamp = now();
    const event: RelationshipEvent = {
      id: randomUUID(),
      ...input,
      ...boundary,
      approvalStatus: "proposed",
      approvedBy: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.update((data) => {
      data.relationshipEvents.unshift(event);
      appendActivity(data, {
        kind: "relationship_event_proposed",
        title: "提出一项关系事件提案",
        summary: event.title,
        source: "RELATIONSHIP",
        world: event.world,
        provenance: event.provenance,
      });
    });
    return event;
  }

  async approveRelationshipEvent(id: string, approvedBy: Actor): Promise<RelationshipEvent> {
    let result: RelationshipEvent | undefined;
    await this.update((data) => {
      result = data.relationshipEvents.find((item) => item.id === id);
      if (!result) throw new Error(`Relationship event not found: ${id}`);
      if (result.approvalStatus === "rejected") {
        throw new Error("A rejected relationship event cannot be approved");
      }
      assertValidRecordBoundary(result);
      if (!result.approvedBy.includes(approvedBy)) result.approvedBy.push(approvedBy);
      const fullyApproved =
        result.importance === "ordinary" ||
        (result.approvedBy.includes("user") && result.approvedBy.includes("agent"));
      result.approvalStatus = fullyApproved ? "approved" : "proposed";
      result.updatedAt = now();
      appendActivity(data, {
        kind: "relationship_event_approval",
        title: fullyApproved ? "关系事件已批准" : "记录关系事件批准",
        summary: result.title,
        source: "RELATIONSHIP",
        world: result.world,
        provenance: result.provenance,
      });
    });
    if (!result) throw new Error(`Relationship event not found: ${id}`);
    return result;
  }

  async markMessageRead(id: string): Promise<ProactiveMessage> {
    let result: ProactiveMessage | undefined;
    await this.update((data) => {
      result = data.proactiveMessages.find((item) => item.id === id);
      if (!result) throw new Error(`Proactive message not found: ${id}`);
      result.readAt ??= now();
    });
    if (!result) throw new Error(`Proactive message not found: ${id}`);
    return result;
  }

  private async persist(data: OurHomeData): Promise<void> {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
      await this.fileSystem.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
  }
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() !== "false";
}