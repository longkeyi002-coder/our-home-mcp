import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ProactiveCandidate } from "./types.js";
import type { JsonStore } from "./store.js";
import type { ProactiveNotifier } from "./worker.js";

export interface FcmSendInput {
  token: string;
  notification: { title: string; body: string };
  data: {
    candidateId: string;
    wakeEventId: string;
    reason: string;
    source: "AGENT_LIFE";
    destination: "/chat";
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

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** Minimal FCM HTTP v1 adapter using service-account ADC from the runtime. */
export class FcmHttpV1Sender implements FcmSender {
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly projectId: string,
    private readonly credentialsPath: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(input: FcmSendInput): Promise<void> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ message: input }),
      },
    );
    if (!response.ok) throw new Error(`FCM send failed with HTTP ${response.status}`);
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
    await this.sender.send({
      token: target.pushToken,
      notification: { title: candidate.title, body: candidate.message },
      data: {
        candidateId: candidate.id,
        wakeEventId: candidate.wakeEventId ?? "",
        reason: candidate.reason,
        source: "AGENT_LIFE",
        destination: "/chat",
      },
    });
  }
}
