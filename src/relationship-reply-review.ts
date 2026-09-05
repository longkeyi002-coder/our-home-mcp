import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { JsonStore } from "./store.js";
import type { OurHomeData } from "./types.js";
import {
  listRelationshipFeedback,
  type RelationshipFeedbackRecord,
} from "./relationship-feedback.js";

export const RELATIONSHIP_REPLY_SUCCESS_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
export const RELATIONSHIP_REPLY_FAILURE_BACKOFF_MS = 60 * 60 * 1_000;
export const RELATIONSHIP_REPLY_DAILY_ATTEMPT_LIMIT = 3;
export const RELATIONSHIP_REPLY_PROCESSING_LEASE_MS = 20 * 60 * 1_000;
export const MAX_RELATIONSHIP_REPLY_TEXT = 5_000;

export type RelationshipReplyProposalClass =
  | "proactive_messages_more"
  | "proactive_messages_less"
  | "suggestions_more"
  | "suggestions_less"
  | "correction";

export interface RelationshipReplyContentRecord {
  id: string;
  world: "EARTH";
  provenance: "user_declared";
  source: "RELATIONSHIP";
  relationshipFeedbackId: string;
  proactiveCandidateId: string;
  text: string;
  textDigest: string;
  occurredAt: string;
  createdAt: string;
  reviewedAt?: string;
  reviewOutcome?: "ignored" | "proposed";
  proposalId?: string;
}

export interface RelationshipReplyInterpretationProposal {
  id: string;
  world: "EARTH";
  provenance: "inferred";
  source: "RELATIONSHIP";
  relationshipFeedbackId: string;
  replyContentId: string;
  proactiveCandidateId: string;
  proposalClass: RelationshipReplyProposalClass;
  summary: string;
  basisKey: string;
  status: "pending";
  createdAt: string;
}

export interface RelationshipReplyReviewInput {
  asOf: string;
  reply: {
    relationshipFeedbackId: string;
    signalKey: string;
    occurredAt: string;
    text: string;
  };
  proactiveMessage: {
    id: string;
    title: string;
    message: string;
    deliveredAt: string;
  };
}

export interface RelationshipReplyReviewAdapter {
  evaluate(input: RelationshipReplyReviewInput): Promise<unknown>;
}

export interface RelationshipReplyReviewRuntimeState {
  utcDay: string;
  attemptsToday: number;
  lastCompletedAt?: string;
  retryAfter?: string;
  processing?: {
    sourceKey: string;
    startedAt: string;
    leaseUntil: string;
  };
}

export type RelationshipReplyReviewCycleStatus =
  | "no_due"
  | "success_cooldown"
  | "retry_backoff"
  | "daily_budget"
  | "processing"
  | "reconciled"
  | "ignored"
  | "proposed"
  | "provider_failed";

export interface RelationshipReplyReviewCycleResult {
  status: RelationshipReplyReviewCycleStatus;
  attempted: boolean;
  replyContentId?: string;
  proposalId?: string;
  error?: string;
}

type RelationshipReplyStoreData = OurHomeData & {
  relationshipReplyContent?: RelationshipReplyContentRecord[];
  relationshipReplyProposals?: RelationshipReplyInterpretationProposal[];
  relationshipReplyReviewRuntime?: RelationshipReplyReviewRuntimeState;
};

const replyContentInputSchema = z.object({
  relationshipFeedbackId: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(MAX_RELATIONSHIP_REPLY_TEXT),
}).strict();

const reviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore") }).strict(),
  z.object({
    action: z.literal("propose_feedback"),
    proposal: z.object({
      class: z.enum([
        "proactive_messages_more",
        "proactive_messages_less",
        "suggestions_more",
        "suggestions_less",
        "correction",
      ]),
      summary: z.string().trim().min(1).max(1_000),
    }).strict(),
  }).strict(),
]);

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function isoAfter(asOf: string, deltaMs: number): string {
  return new Date(timestamp(asOf, "relationship reply review asOf") + deltaMs).toISOString();
}

function utcDay(asOf: string): string {
  return new Date(timestamp(asOf, "relationship reply review asOf")).toISOString().slice(0, 10);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceKey(content: RelationshipReplyContentRecord): string {
  return `${content.relationshipFeedbackId}:${content.textDigest}`;
}

function basisKey(content: RelationshipReplyContentRecord): string {
  return digest(`relationship-reply-review\n${sourceKey(content)}`);
}

function relationshipFeedbackById(store: JsonStore, id: string): RelationshipFeedbackRecord {
  const record = listRelationshipFeedback(store).find((item) => item.id === id);
  if (!record) throw new Error(`Relationship reply feedback not found: ${id}`);
  if (record.signal !== "reply") throw new Error("Relationship reply content requires a P6.1 reply signal");
  return record;
}

function assertReplyContent(record: RelationshipReplyContentRecord): void {
  if (record.world !== "EARTH" || record.provenance !== "user_declared" || record.source !== "RELATIONSHIP") {
    throw new Error("Relationship reply content has an invalid Earth boundary");
  }
  if (!record.id || !record.relationshipFeedbackId || !record.proactiveCandidateId) {
    throw new Error("Relationship reply content has invalid structured fields");
  }
  const text = record.text.trim();
  if (!text || text.length > MAX_RELATIONSHIP_REPLY_TEXT) throw new Error("Relationship reply content text is invalid");
  if (record.textDigest !== digest(text)) throw new Error("Relationship reply content digest is invalid");
  if (timestamp(record.occurredAt, "relationship reply occurredAt") > timestamp(record.createdAt, "relationship reply createdAt")) {
    throw new Error("Relationship reply content cannot occur after creation");
  }
  if ((record.reviewedAt === undefined) !== (record.reviewOutcome === undefined)) {
    throw new Error("Relationship reply review lifecycle is inconsistent");
  }
  if (record.reviewedAt) {
    if (timestamp(record.reviewedAt, "relationship reply reviewedAt") < timestamp(record.createdAt, "relationship reply createdAt")) {
      throw new Error("Relationship reply cannot be reviewed before creation");
    }
    if (record.reviewOutcome === "proposed" && !record.proposalId) {
      throw new Error("Proposed relationship reply review requires proposalId");
    }
    if (record.reviewOutcome === "ignored" && record.proposalId) {
      throw new Error("Ignored relationship reply review cannot carry proposalId");
    }
  } else if (record.proposalId) {
    throw new Error("Unreviewed relationship reply cannot carry proposalId");
  }
}

function assertProposal(record: RelationshipReplyInterpretationProposal): void {
  if (record.world !== "EARTH" || record.provenance !== "inferred" || record.source !== "RELATIONSHIP") {
    throw new Error("Relationship reply proposal has an invalid Earth boundary");
  }
  if (!record.id || !record.relationshipFeedbackId || !record.replyContentId || !record.proactiveCandidateId || !record.basisKey) {
    throw new Error("Relationship reply proposal has invalid structured fields");
  }
  if (!reviewDecisionSchema.safeParse({
    action: "propose_feedback",
    proposal: { class: record.proposalClass, summary: record.summary },
  }).success) {
    throw new Error("Relationship reply proposal payload is invalid");
  }
  if (record.status !== "pending") throw new Error("Relationship reply proposal has invalid status");
  timestamp(record.createdAt, "relationship reply proposal createdAt");
}

function replyContentRecords(snapshot: OurHomeData): RelationshipReplyContentRecord[] {
  const records = (snapshot as RelationshipReplyStoreData).relationshipReplyContent ?? [];
  if (!Array.isArray(records)) throw new Error("Persisted relationship reply content must be an array");
  const ids = new Set<string>();
  const feedbackIds = new Set<string>();
  for (const record of records) {
    assertReplyContent(record);
    if (ids.has(record.id)) throw new Error("Duplicate relationship reply content id");
    if (feedbackIds.has(record.relationshipFeedbackId)) throw new Error("Duplicate relationship reply feedback binding");
    ids.add(record.id);
    feedbackIds.add(record.relationshipFeedbackId);
  }
  return records;
}

function proposalRecords(snapshot: OurHomeData): RelationshipReplyInterpretationProposal[] {
  const records = (snapshot as RelationshipReplyStoreData).relationshipReplyProposals ?? [];
  if (!Array.isArray(records)) throw new Error("Persisted relationship reply proposals must be an array");
  const ids = new Set<string>();
  const bases = new Set<string>();
  for (const record of records) {
    assertProposal(record);
    if (ids.has(record.id)) throw new Error("Duplicate relationship reply proposal id");
    if (bases.has(record.basisKey)) throw new Error("Duplicate relationship reply proposal basis");
    ids.add(record.id);
    bases.add(record.basisKey);
  }
  return records;
}

function runtimeState(snapshot: OurHomeData, asOf: string): RelationshipReplyReviewRuntimeState {
  const data = snapshot as RelationshipReplyStoreData;
  const day = utcDay(asOf);
  const current = data.relationshipReplyReviewRuntime;
  if (!current) return { utcDay: day, attemptsToday: 0 };
  if (!Number.isInteger(current.attemptsToday) || current.attemptsToday < 0) {
    throw new Error("Relationship reply review attemptsToday is invalid");
  }
  if (current.lastCompletedAt) timestamp(current.lastCompletedAt, "relationship reply review lastCompletedAt");
  if (current.retryAfter) timestamp(current.retryAfter, "relationship reply review retryAfter");
  if (current.processing) {
    if (!current.processing.sourceKey) throw new Error("Relationship reply review processing sourceKey is invalid");
    timestamp(current.processing.startedAt, "relationship reply review processing startedAt");
    timestamp(current.processing.leaseUntil, "relationship reply review processing leaseUntil");
  }
  if (current.utcDay !== day) return { utcDay: day, attemptsToday: 0 };
  return structuredClone(current);
}

function deliveredCandidate(store: JsonStore, id: string) {
  const candidate = store.snapshot().proactiveQueue.find((item) => item.id === id);
  if (!candidate || candidate.status !== "delivered" || !candidate.deliveredAt) {
    throw new Error("Relationship reply review requires an existing delivered proactive message");
  }
  return candidate;
}

export function listRelationshipReplyContent(store: JsonStore): RelationshipReplyContentRecord[] {
  return replyContentRecords(store.snapshot()).map((item) => structuredClone(item));
}

export function listRelationshipReplyProposals(store: JsonStore): RelationshipReplyInterpretationProposal[] {
  return proposalRecords(store.snapshot()).map((item) => structuredClone(item));
}

export function readRelationshipReplyReviewRuntimeState(
  store: JsonStore,
  asOf = new Date().toISOString(),
): RelationshipReplyReviewRuntimeState {
  return runtimeState(store.snapshot(), asOf);
}

export async function recordRelationshipReplyContent(
  store: JsonStore,
  input: unknown,
  asOf = new Date().toISOString(),
): Promise<{ record: RelationshipReplyContentRecord; duplicate: boolean }> {
  const parsed = replyContentInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("Relationship reply content violated the strict input contract");
  const feedback = relationshipFeedbackById(store, parsed.data.relationshipFeedbackId);
  const candidate = deliveredCandidate(store, feedback.proactiveCandidateId);
  const text = parsed.data.text.trim();
  if (timestamp(feedback.occurredAt, "relationship reply signal occurredAt") < timestamp(candidate.deliveredAt!, "proactive deliveredAt")) {
    throw new Error("Relationship reply content cannot bind to a pre-delivery reply signal");
  }
  if (timestamp(feedback.occurredAt, "relationship reply occurredAt") > timestamp(asOf, "relationship reply createdAt")) {
    throw new Error("Relationship reply content cannot occur after creation");
  }

  const existing = replyContentRecords(store.snapshot()).find((item) => item.relationshipFeedbackId === feedback.id);
  if (existing) {
    if (existing.text !== text) throw new Error("Relationship reply content conflicts with the existing reply binding");
    return { record: structuredClone(existing), duplicate: true };
  }

  const record: RelationshipReplyContentRecord = {
    id: randomUUID(),
    world: "EARTH",
    provenance: "user_declared",
    source: "RELATIONSHIP",
    relationshipFeedbackId: feedback.id,
    proactiveCandidateId: feedback.proactiveCandidateId,
    text,
    textDigest: digest(text),
    occurredAt: feedback.occurredAt,
    createdAt: asOf,
  };

  let result: RelationshipReplyContentRecord | undefined;
  let duplicate = false;
  await store.update((raw) => {
    const data = raw as RelationshipReplyStoreData;
    const raced = replyContentRecords(data).find((item) => item.relationshipFeedbackId === feedback.id);
    if (raced) {
      if (raced.text !== text) throw new Error("Relationship reply content conflicts with the existing reply binding");
      result = raced;
      duplicate = true;
      return;
    }
    data.relationshipReplyContent ??= [];
    data.relationshipReplyContent.unshift(record);
    result = record;
  });
  if (!result) throw new Error("Relationship reply content was not persisted");
  return { record: structuredClone(result), duplicate };
}

function nextDueReply(store: JsonStore): RelationshipReplyContentRecord | undefined {
  return replyContentRecords(store.snapshot())
    .filter((item) => !item.reviewedAt)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
}

function gateStatus(
  store: JsonStore,
  asOf: string,
): Exclude<RelationshipReplyReviewCycleStatus, "no_due" | "reconciled" | "ignored" | "proposed" | "provider_failed"> | undefined {
  const now = timestamp(asOf, "relationship reply review asOf");
  const state = runtimeState(store.snapshot(), asOf);
  if (state.processing && timestamp(state.processing.leaseUntil, "relationship reply review leaseUntil") > now) return "processing";
  if (state.retryAfter && timestamp(state.retryAfter, "relationship reply review retryAfter") > now) return "retry_backoff";
  if (state.lastCompletedAt && now - timestamp(state.lastCompletedAt, "relationship reply review lastCompletedAt") < RELATIONSHIP_REPLY_SUCCESS_COOLDOWN_MS) {
    return "success_cooldown";
  }
  if (state.attemptsToday >= RELATIONSHIP_REPLY_DAILY_ATTEMPT_LIMIT) return "daily_budget";
  return undefined;
}

async function claimAttempt(store: JsonStore, content: RelationshipReplyContentRecord, asOf: string): Promise<void> {
  await store.update((raw) => {
    const data = raw as RelationshipReplyStoreData;
    const current = runtimeState(data, asOf);
    data.relationshipReplyReviewRuntime = {
      ...current,
      utcDay: utcDay(asOf),
      attemptsToday: current.attemptsToday + 1,
      processing: {
        sourceKey: sourceKey(content),
        startedAt: asOf,
        leaseUntil: isoAfter(asOf, RELATIONSHIP_REPLY_PROCESSING_LEASE_MS),
      },
    };
  });
}

async function markFailure(store: JsonStore, asOf: string): Promise<void> {
  await store.update((raw) => {
    const data = raw as RelationshipReplyStoreData;
    const current = runtimeState(data, asOf);
    data.relationshipReplyReviewRuntime = {
      ...current,
      processing: undefined,
      retryAfter: isoAfter(asOf, RELATIONSHIP_REPLY_FAILURE_BACKOFF_MS),
    };
  });
}

async function markCompleted(store: JsonStore, asOf: string): Promise<void> {
  await store.update((raw) => {
    const data = raw as RelationshipReplyStoreData;
    const current = runtimeState(data, asOf);
    data.relationshipReplyReviewRuntime = {
      ...current,
      processing: undefined,
      retryAfter: undefined,
      lastCompletedAt: asOf,
    };
  });
}

function reviewInput(store: JsonStore, content: RelationshipReplyContentRecord, asOf: string): RelationshipReplyReviewInput {
  const feedback = relationshipFeedbackById(store, content.relationshipFeedbackId);
  if (feedback.proactiveCandidateId !== content.proactiveCandidateId) {
    throw new Error("Relationship reply content subject changed before review");
  }
  const candidate = deliveredCandidate(store, content.proactiveCandidateId);
  return {
    asOf,
    reply: {
      relationshipFeedbackId: feedback.id,
      signalKey: feedback.signalKey,
      occurredAt: feedback.occurredAt,
      text: content.text,
    },
    proactiveMessage: {
      id: candidate.id,
      title: candidate.title.slice(0, 200),
      message: candidate.message.slice(0, 5_000),
      deliveredAt: candidate.deliveredAt!,
    },
  };
}

async function finalizeIgnored(store: JsonStore, contentId: string, asOf: string): Promise<void> {
  await store.update((raw) => {
    const data = raw as RelationshipReplyStoreData;
    const content = (data.relationshipReplyContent ?? []).find((item) => item.id === contentId);
    if (!content) throw new Error("Relationship reply content disappeared during review");
    if (content.reviewedAt) return;
    content.reviewedAt = asOf;
    content.reviewOutcome = "ignored";
  });
}

async function finalizeProposal(
  store: JsonStore,
  content: RelationshipReplyContentRecord,
  proposalClass: RelationshipReplyProposalClass,
  summary: string,
  asOf: string,
): Promise<RelationshipReplyInterpretationProposal> {
  const basis = basisKey(content);
  let result: RelationshipReplyInterpretationProposal | undefined;
  await store.update((raw) => {
    const data = raw as RelationshipReplyStoreData;
    data.relationshipReplyProposals ??= [];
    const existing = proposalRecords(data).find((item) => item.basisKey === basis);
    const current = (data.relationshipReplyContent ?? []).find((item) => item.id === content.id);
    if (!current) throw new Error("Relationship reply content disappeared during proposal persistence");
    if (existing) {
      current.reviewedAt ??= asOf;
      current.reviewOutcome ??= "proposed";
      current.proposalId ??= existing.id;
      result = existing;
      return;
    }
    const proposal: RelationshipReplyInterpretationProposal = {
      id: randomUUID(),
      world: "EARTH",
      provenance: "inferred",
      source: "RELATIONSHIP",
      relationshipFeedbackId: content.relationshipFeedbackId,
      replyContentId: content.id,
      proactiveCandidateId: content.proactiveCandidateId,
      proposalClass,
      summary,
      basisKey: basis,
      status: "pending",
      createdAt: asOf,
    };
    data.relationshipReplyProposals.unshift(proposal);
    current.reviewedAt = asOf;
    current.reviewOutcome = "proposed";
    current.proposalId = proposal.id;
    result = proposal;
  });
  if (!result) throw new Error("Relationship reply proposal was not persisted");
  return structuredClone(result);
}

export async function runRelationshipReplyReviewCycle(
  store: JsonStore,
  adapter: RelationshipReplyReviewAdapter,
  asOf = new Date().toISOString(),
): Promise<RelationshipReplyReviewCycleResult> {
  timestamp(asOf, "relationship reply review asOf");
  const content = nextDueReply(store);
  if (!content) return { status: "no_due", attempted: false };

  const existing = proposalRecords(store.snapshot()).find((item) => item.basisKey === basisKey(content));
  if (existing) {
    await finalizeProposal(store, content, existing.proposalClass, existing.summary, asOf);
    await markCompleted(store, asOf);
    return { status: "reconciled", attempted: false, replyContentId: content.id, proposalId: existing.id };
  }

  const blocked = gateStatus(store, asOf);
  if (blocked) return { status: blocked, attempted: false, replyContentId: content.id };

  await claimAttempt(store, content, asOf);
  try {
    const parsed = reviewDecisionSchema.safeParse(await adapter.evaluate(reviewInput(store, content, asOf)));
    if (!parsed.success) throw new Error("Relationship reply review provider violated the bounded decision contract");
    if (parsed.data.action === "ignore") {
      await finalizeIgnored(store, content.id, asOf);
      await markCompleted(store, asOf);
      return { status: "ignored", attempted: true, replyContentId: content.id };
    }
    const proposal = await finalizeProposal(store, content, parsed.data.proposal.class, parsed.data.proposal.summary, asOf);
    await markCompleted(store, asOf);
    return {
      status: "proposed",
      attempted: true,
      replyContentId: content.id,
      proposalId: proposal.id,
    };
  } catch (error) {
    await markFailure(store, asOf);
    const message = error instanceof Error ? error.message : "Unknown relationship reply review provider error";
    return { status: "provider_failed", attempted: true, replyContentId: content.id, error: message };
  }
}

/** Generic provider-neutral webhook adapter. Runtime still validates the response independently. */
export class WebhookRelationshipReplyReviewEngine implements RelationshipReplyReviewAdapter {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async evaluate(input: RelationshipReplyReviewInput): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Relationship reply review engine returned HTTP ${response.status}`);
    return response.json();
  }
}
