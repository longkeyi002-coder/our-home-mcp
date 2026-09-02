import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
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
  RelationshipEvent,
  RoutineWindow,
} from "./types.js";

const now = () => new Date().toISOString();

function appendActivity(
  data: OurHomeData,
  input: {
    kind: string;
    title: string;
    summary?: string;
    source: "AGENT_LIFE" | "RELATIONSHIP" | "HOME_STATE";
  },
): void {
  data.activities.unshift({
    id: randomUUID(),
    ...input,
    occurredAt: now(),
  });
}

function emptyData(): OurHomeData {
  const timestamp = now();
  return {
    schemaVersion: 2,
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
  };
}

function seedData(): OurHomeData {
  const timestamp = now();
  return {
    schemaVersion: 2,
    diaries: [
      {
        id: "diary_seed_welcome",
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
  };
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
      schemaVersion: 2,
      observations: [],
      routines: [],
      heartbeats: [],
      proactiveQueue: [],
    };
  }
  if (
    candidate.schemaVersion !== 2 ||
    !Array.isArray(candidate.observations) ||
    !Array.isArray(candidate.routines) ||
    !Array.isArray(candidate.heartbeats) ||
    !Array.isArray(candidate.proactiveQueue)
  ) {
    throw new Error("Unsupported or corrupt Our Home data file");
  }
  return candidate as OurHomeData;
}

export class JsonStore {
  private constructor(private readonly db: Database.Database) {}

  static async open(filePath: string, seed = true): Promise<JsonStore> {
    const resolvedPath = resolve(filePath);
    await mkdir(resolve(resolvedPath, ".."), { recursive: true });
    const db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS our_home_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
      )
    `);
    const existing = db.prepare("SELECT payload FROM our_home_state WHERE id = 1").get() as { payload: string } | undefined;
    if (!existing) {
      db.prepare("INSERT INTO our_home_state (id, payload) VALUES (1, ?)").run(JSON.stringify(seed ? seedData() : emptyData()));
    } else {
      const migrated = migrateData(JSON.parse(existing.payload));
      if (JSON.stringify(migrated) !== existing.payload) {
        db.prepare("UPDATE our_home_state SET payload = ? WHERE id = 1").run(JSON.stringify(migrated));
      }
    }
    return new JsonStore(db);
  }

  snapshot(): OurHomeData {
    const row = this.db.prepare("SELECT payload FROM our_home_state WHERE id = 1").get() as { payload: string } | undefined;
    if (!row) throw new Error("Our Home SQLite state is missing");
    return migrateData(JSON.parse(row.payload));
  }

  getLifeContext(observedAt = now()): LifeContext {
    const data = this.snapshot();
    return {
      observedAt,
      observations: data.observations.filter(
        (item) => {
          if (!item.expiresAt) return true;
          const expiresAt = Date.parse(item.expiresAt);
          const observedAtMs = Date.parse(observedAt);
          return Number.isFinite(expiresAt) && Number.isFinite(observedAtMs) && expiresAt >= observedAtMs;
        },
      ).slice(0, 50),
      routines: data.routines.filter((item) => item.enabled),
      recentHeartbeats: data.heartbeats.slice(0, 10),
      pendingProactiveMessages: data.proactiveQueue
        .filter((item) => item.status === "pending")
        .slice(0, 20),
    };
  }

  async update(mutator: (data: OurHomeData) => void): Promise<OurHomeData> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const data = this.snapshot();
      mutator(data);
      this.db.prepare("UPDATE our_home_state SET payload = ? WHERE id = 1").run(JSON.stringify(data));
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
    return this.snapshot();
  }

  async addDiary(input: {
    title: string;
    body: string;
    author: Actor;
    visibility: DiaryVisibility;
  }): Promise<DiaryEntry> {
    const timestamp = now();
    const entry: DiaryEntry = {
      id: randomUUID(),
      ...input,
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
  }): Promise<LifeObservation> {
    const observation: LifeObservation = { id: randomUUID(), ...input };
    await this.update((data) => {
      data.observations.unshift(observation);
      appendActivity(data, {
        kind: "observation_recorded",
        title: "记录一条生活观察",
        summary: observation.label,
        source: "HOME_STATE",
      });
    });
    return observation;
  }

  async recordPhoneHeartbeat(input: {
    deviceId: string;
    status: string;
    observedAt: string;
    foregroundPackage?: string;
    metadata?: Record<string, string | number | boolean>;
    clientEventId?: string;
  }): Promise<{ observation: LifeObservation; foregroundObservation?: LifeObservation; created: boolean }> {
    let result!: { observation: LifeObservation; foregroundObservation?: LifeObservation; created: boolean };
    await this.update((data) => {
      const existing = input.clientEventId
        ? data.observations.find(
            (item) => item.deviceId === input.deviceId && item.metadata?.clientEventId === input.clientEventId,
          )
        : undefined;
      if (existing) {
        result = {
          observation: existing,
          foregroundObservation: data.observations.find(
            (item) => item.metadata?.heartbeatObservationId === existing.id,
          ),
          created: false,
        };
        return;
      }

      const observation: LifeObservation = {
        id: randomUUID(),
        kind: "device_presence",
        label: `手机 ${input.status}`,
        value: input.status,
        observedAt: input.observedAt,
        source: "phone",
        confidence: "observed",
        deviceId: input.deviceId,
        metadata: input.metadata,
      };
      const foregroundObservation = input.foregroundPackage
        ? {
            id: randomUUID(),
            kind: "screen_app" as const,
            label: "当前前台应用包名",
            value: input.foregroundPackage,
            observedAt: input.observedAt,
            source: "phone" as const,
            confidence: "observed" as const,
            deviceId: input.deviceId,
            metadata: { heartbeatObservationId: observation.id },
          }
        : undefined;
      data.observations.unshift(
        ...[observation, foregroundObservation].filter((item): item is LifeObservation => Boolean(item)),
      );
      appendActivity(data, {
        kind: "observation_recorded",
        title: "记录一条手机心跳",
        summary: observation.label,
        source: "HOME_STATE",
      });
      result = { observation, foregroundObservation, created: true };
    });
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
  }): Promise<ProactiveCandidate> {
    let candidate: ProactiveCandidate | undefined;
    await this.update((data) => {
      const existing = input.dedupeKey
        ? data.proactiveQueue.find((item) => item.status === "pending" && item.dedupeKey === input.dedupeKey)
        : undefined;
      if (existing) {
        candidate = structuredClone(existing);
        return;
      }
      candidate = {
        id: randomUUID(),
        ...input,
        status: "pending",
        createdAt: now(),
        attempts: 0,
        source: "AGENT_LIFE",
      };
      data.proactiveQueue.unshift(candidate);
      appendActivity(data, {
        kind: "proactive_candidate_scheduled",
        title: "安排一条主动消息",
        summary: candidate.title,
        source: "AGENT_LIFE",
      });
    });
    if (!candidate) throw new Error("Failed to schedule proactive candidate");
    return candidate;
  }

  listDueProactiveMessages(asOf = new Date().toISOString()): ProactiveCandidate[] {
    const asOfMs = Date.parse(asOf);
    return this.snapshot().proactiveQueue
      .filter((item) => {
        const dueAt = Date.parse(item.dueAt);
        const claimExpiresAt = item.claimExpiresAt ? Date.parse(item.claimExpiresAt) : NaN;
        return item.status === "pending" && Number.isFinite(dueAt) && dueAt <= asOfMs &&
          (!item.claimExpiresAt || (Number.isFinite(claimExpiresAt) && claimExpiresAt <= asOfMs));
      })
      .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
  }

  async claimDueProactiveMessages(asOf = new Date(), limit = 100, leaseMs = 5 * 60_000): Promise<ProactiveCandidate[]> {
    const asOfIso = asOf.toISOString();
    const asOfMs = asOf.getTime();
    const claimExpiresAt = new Date(asOfMs + leaseMs).toISOString();
    const claimId = randomUUID();
    let claimed: ProactiveCandidate[] = [];
    await this.update((data) => {
      claimed = data.proactiveQueue
        .filter((item) => {
          const dueAt = Date.parse(item.dueAt);
          const claimExpires = item.claimExpiresAt ? Date.parse(item.claimExpiresAt) : NaN;
          return item.status === "pending" && Number.isFinite(dueAt) && dueAt <= asOfMs &&
            (!item.claimExpiresAt || (Number.isFinite(claimExpires) && claimExpires <= asOfMs));
        })
        .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))
        .slice(0, limit);
      for (const item of claimed) {
        item.claimId = claimId;
        item.claimExpiresAt = claimExpiresAt;
      }
      claimed = structuredClone(claimed);
    });
    return claimed;
  }

  async recordProactiveAttempt(id: string, error?: string, claimId?: string, releaseClaim = false): Promise<ProactiveCandidate> {
    let result: ProactiveCandidate | undefined;
    await this.update((data) => {
      result = data.proactiveQueue.find((item) => item.id === id);
      if (!result) throw new Error(`Proactive candidate not found: ${id}`);
      if (claimId && result.claimId !== claimId) throw new Error("Proactive candidate claim is no longer valid");
      result.attempts += 1;
      result.lastAttemptAt = now();
      result.lastError = error;
      if (releaseClaim) {
        delete result.claimId;
        delete result.claimExpiresAt;
      }
    });
    if (!result) throw new Error(`Proactive candidate not found: ${id}`);
    return result;
  }

  async resolveProactiveMessage(id: string, status: Exclude<ProactiveCandidateStatus, "pending">, claimId?: string): Promise<ProactiveCandidate> {
    let result: ProactiveCandidate | undefined;
    await this.update((data) => {
      result = data.proactiveQueue.find((item) => item.id === id);
      if (!result) throw new Error(`Proactive candidate not found: ${id}`);
      if (claimId && result.claimId !== claimId) throw new Error("Proactive candidate claim is no longer valid");
      result.status = status;
      if (status === "delivered") result.deliveredAt = now();
      if (status === "dismissed") result.dismissedAt = now();
      delete result.claimId;
      delete result.claimExpiresAt;
    });
    if (!result) throw new Error(`Proactive candidate not found: ${id}`);
    return result;
  }

  async addAction(input: {
    title: string;
    description?: string;
    dueAt?: string;
  }): Promise<ActionItem> {
    const action: ActionItem = {
      id: randomUUID(),
      ...input,
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
  }): Promise<RelationshipEvent> {
    const timestamp = now();
    const event: RelationshipEvent = {
      id: randomUUID(),
      ...input,
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
      });
    });
    return event;
  }

  async approveRelationshipEvent(id: string, approvedBy: Actor, subject: string = approvedBy): Promise<RelationshipEvent> {
    let result: RelationshipEvent | undefined;
    await this.update((data) => {
      result = data.relationshipEvents.find((item) => item.id === id);
      if (!result) throw new Error(`Relationship event not found: ${id}`);
      if (result.approvalStatus === "rejected") {
        throw new Error("A rejected relationship event cannot be approved");
      }
      result.approvalSubjects ??= {};
      const otherActor: Actor = approvedBy === "user" ? "agent" : "user";
      if (result.approvalSubjects[otherActor] === subject) {
        throw new Error("Major relationship events require two distinct authenticated identities");
      }
      if (!result.approvedBy.includes(approvedBy)) result.approvedBy.push(approvedBy);
      result.approvalSubjects[approvedBy] = subject;
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

}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() !== "false";
}
