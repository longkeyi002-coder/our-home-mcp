export type SourceType =
  | "REALITY"
  | "AGENT_LIFE"
  | "RELATIONSHIP"
  | "HOME_STATE";

export type Capability = "available" | "unavailable" | "placeholder";
export type Actor = "user" | "agent";
export type DiaryVisibility = "private" | "shared";
export type ActionStatus = "todo" | "in_progress" | "done";
export type RelationshipApprovalStatus = "proposed" | "approved" | "rejected";
export type ObservationKind =
  | "manual_status"
  | "device_presence"
  | "screen_app"
  | "calendar"
  | "weather"
  | "note";
export type ObservationSource = "user" | "phone" | "screen" | "calendar" | "system" | "mock";
export type ObservationConfidence = "observed" | "declared" | "inferred";
export type ProactiveCandidateStatus = "pending" | "delivered" | "dismissed";
export type LifeActivity = "active_on_phone" | "probably_idle" | "charging" | "offline" | "unknown";
export type DevicePresence = "online" | "screen_on" | "screen_off" | "idle" | "unknown";
export type ConnectivityState = "online" | "offline" | "unknown";
export type WakeEventType = "became_active" | "became_idle" | "device_offline" | "charging_started" | "battery_low";
export type WakeEventStatus = "pending" | "handled" | "dismissed";
export type WakeEventPriority = "low" | "normal" | "high";

export interface DiaryEntry {
  id: string;
  title: string;
  body: string;
  author: Actor;
  visibility: DiaryVisibility;
  source: "AGENT_LIFE" | "RELATIONSHIP";
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipEvent {
  id: string;
  title: string;
  description?: string;
  occurredAt: string;
  proposedBy: Actor;
  importance: "ordinary" | "major";
  approvalStatus: RelationshipApprovalStatus;
  approvedBy: Actor[];
  createdAt: string;
  updatedAt: string;
}

export interface ActionItem {
  id: string;
  title: string;
  description?: string;
  status: ActionStatus;
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
  source: "AGENT_LIFE" | "REALITY";
}

export interface AgentActivity {
  id: string;
  kind: string;
  title: string;
  summary?: string;
  occurredAt: string;
  source: SourceType;
}

export interface ProactiveMessage {
  id: string;
  message: string;
  createdAt: string;
  readAt?: string;
  source: "AGENT_LIFE";
}

export interface HomeState {
  presence: "unknown" | "sleeping" | "awake" | "working" | "waiting";
  note?: string;
  updatedAt: string;
  source: "HOME_STATE";
}

export interface LifeObservation {
  id: string;
  kind: ObservationKind;
  label: string;
  value?: string;
  observedAt: string;
  source: ObservationSource;
  confidence: ObservationConfidence;
  expiresAt?: string;
  deviceId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface LifeState {
  lastObservedAt: string | null;
  lastPhoneActivityAt: string | null;
  devicePresence: DevicePresence;
  foregroundPackage: string | null;
  batteryPercent: number | null;
  charging: boolean | null;
  connectivityState: ConnectivityState;
  currentActivity: LifeActivity;
  confidence: number;
  reasons: string[];
}

export interface WakeEvent {
  id: string;
  type: WakeEventType;
  status: WakeEventStatus;
  priority: WakeEventPriority;
  createdAt: string;
  observedAt: string;
  reason: string;
  dedupeKey: string;
  lifeState: LifeState;
  previousLifeState: LifeState;
}

export interface WakeEngineState {
  lastLifeState: LifeState | null;
  lastEventAt: Partial<Record<WakeEventType, string>>;
}

export interface RoutineWindow {
  id: string;
  label: string;
  weekdays: number[];
  startLocal: string;
  endLocal: string;
  timezone: string;
  note?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HeartbeatRecord {
  id: string;
  occurredAt: string;
  summary: string;
  source: "system";
}

export interface ProactiveCandidate {
  id: string;
  title: string;
  message: string;
  reason: string;
  dueAt: string;
  status: ProactiveCandidateStatus;
  createdAt: string;
  deliveredAt?: string;
  dismissedAt?: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  source: "AGENT_LIFE" | "HOME_STATE";
  dedupeKey?: string;
  wakeEventId?: string;
}

export type WakeDecision =
  | { action: "ignore" }
  | { action: "proactive_message"; candidate: { title: string; message: string; reason: string; dueAt?: string; dedupeKey?: string } };

export interface LifeContext {
  observedAt: string;
  lifeState: LifeState;
  observations: LifeObservation[];
  routines: RoutineWindow[];
  recentHeartbeats: HeartbeatRecord[];
  pendingProactiveMessages: ProactiveCandidate[];
  pendingWakeEvents: WakeEvent[];
}

export interface OurHomeData {
  schemaVersion: 2;
  diaries: DiaryEntry[];
  relationshipEvents: RelationshipEvent[];
  actions: ActionItem[];
  activities: AgentActivity[];
  proactiveMessages: ProactiveMessage[];
  homeState: HomeState;
  observations: LifeObservation[];
  routines: RoutineWindow[];
  heartbeats: HeartbeatRecord[];
  proactiveQueue: ProactiveCandidate[];
  wakeEvents: WakeEvent[];
  wakeEngineState: WakeEngineState;
}

export interface DataStatus {
  domain: string;
  source: "local-mock" | "home-backend" | "hermes";
  capability: Capability;
  fetchedAt: string;
  note?: string;
}
