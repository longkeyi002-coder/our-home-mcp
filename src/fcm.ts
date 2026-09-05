import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ProactiveCandidate } from "./types.js";
import type { JsonStore } from "./store.js";
import type { ProactiveNotifier } from "./worker.js";

export interface FcmSendInput {
  token: string;
  data: {
    candidateId: string;
    wakeEventId: string;
    reason: string;
    source: "AGENT_LIFE";
    destination: "/chat";
    title: string;
    body: string;
  };
  android: {
    priority: "HIGH";
    ttl: "3600s";
    collapse_key: string;
  };
}

export interface FcmSender {
  send(input: FcmSendInput): Promise<void>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export class FcmSendError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode?: string,
  ) {
    super(`FCM send failed with HTTP ${status}${errorCode ? ` (${errorCode})` : ""}`);
    this.name = "FcmSendError";
  }
}

export function fcmErrorCodeFromPayload(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const errorCode = (detail as { errorCode?: unknown }).errorCode;
    if (typeof errorCode === "string" && errorCode.trim()) return errorCode.trim();
  }
  return undefined;
}

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** Minimal FCM HTTP v1 adapter using service-account ADC from the runtime. */
export class FcmHttpV1Sender implements FcmSender {
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly projectId: string,
    private readonly credentialsPath: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  async send(input: FcmSendInput): Promise<void> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ message: input }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      throw new FcmSendError(response.status, fcmErrorCodeFromPayload(payload));
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const credentials = JSON.parse(await readFile(this.credentialsPath, "utf8")) as Partial<ServiceAccount>;
    if (!credentials.client_email || !credentials.private_key) throw new Error("Invalid Firebase service-account credentials");
    const issuedAt = Math.floor(Date.now() / 1000);
    const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
    const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = encode(JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }));
    const unsigned = `${header}.${claim}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${encode(signer.sign(credentials.private_key))}`;
    const response = await this.fetcher(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`FCM authentication failed with HTTP ${response.status}`);
    const value = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof value.access_token !== "string") throw new Error("FCM authentication returned no access token");
    const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;
    this.accessToken = { value: value.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return value.access_token;
  }
}

export class FcmNotifier implements ProactiveNotifier {
  constructor(private readonly store: JsonStore, private readonly sender: FcmSender) {}

  async deliver(candidate: ProactiveCandidate): Promise<void> {
    const target = this.store.getPrimaryPushDevice();
    if (!target?.pushToken) throw new Error("No Android push target is registered");
    const pushToken = target.pushToken;
    // OH-P2: use data-only FCM. Mixed notification+data messages are rendered by
    // Google Play services while the app is backgrounded and can bypass our custom
    // PendingIntent. Data-only delivery ensures FirebaseMessagingService builds the
    // notification itself, preserving the /chat message destination. High priority is
    // appropriate because every successful message becomes a visible user notification.
    // A bounded TTL prevents old context-sensitive care messages arriving much later;
    // collapse_key keeps ambiguous network retries for the same candidate idempotent in FCM.
    try {
      await this.sender.send({
        token: pushToken,
        data: {
          candidateId: candidate.id,
          wakeEventId: candidate.wakeEventId ?? "",
          reason: candidate.reason,
          source: "AGENT_LIFE",
          destination: "/chat",
          title: candidate.title,
          body: candidate.message,
        },
        android: {
          priority: "HIGH",
          ttl: "3600s",
          collapse_key: candidate.id,
        },
      });
    } catch (error) {
      if (error instanceof FcmSendError && error.errorCode === "UNREGISTERED") {
        await this.store.update((data) => {
          const current = data.phoneDeviceRegistrations.find((item) => item.deviceId === target.deviceId);
          // Only invalidate the exact token that failed. A concurrent Android refresh
          // may already have replaced it while this request was in flight.
          if (!current || current.pushToken !== pushToken) return;
          delete current.pushToken;
          delete current.pushFid;
          current.updatedAt = new Date().toISOString();
        });
      }
      throw error;
    }
  }
}
