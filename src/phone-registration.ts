import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { JsonStore } from "./store.js";

export const phoneRegisterSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  appVersion: z.string().trim().max(100).optional(),
  pushFid: z.string().trim().min(1).max(500).optional(),
  pushToken: z.string().trim().min(1).max(4_096).optional(),
});

export function createDeviceToken(ingestToken: string, deviceId: string): string {
  return createHmac("sha256", ingestToken).update(`hermes-phone-v1:${deviceId}`).digest("hex");
}

export function constantTimeTokenEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Check if presented token matches any of the valid tokens */
function matchesAnyToken(presentedToken: string | undefined, validTokens: string[]): boolean {
  return validTokens.some(token => constantTimeTokenEqual(presentedToken, token));
}

export async function registerPhone(
  store: JsonStore,
  ingestToken: string,
  authorization: string | undefined,
  body: unknown,
  enrollmentToken?: string,
) {
  const presentedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  
  // Accept enrollment token (for APK auto-registration) OR ingest token
  const validTokens = enrollmentToken ? [ingestToken, enrollmentToken] : [ingestToken];
  if (!matchesAnyToken(presentedToken, validTokens)) throw new Error("Unauthorized");
  
  const input = phoneRegisterSchema.parse(body);
  await store.registerPhoneDevice(input);
  return {
    deviceId: input.deviceId,
    token: createDeviceToken(ingestToken, input.deviceId),
    appVersion: input.appVersion,
  };
}
