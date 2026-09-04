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

/**
 * OH-P1/OH-42: the Android enrollment token is register-only. It may be injected
 * into a private APK because compromise grants only device enrollment, not MCP or
 * direct telemetry ingest. The existing ingest token remains accepted for backward
 * compatibility and is still the secret used to derive device-scoped credentials.
 */
export async function registerPhone(
  store: JsonStore,
  ingestToken: string,
  authorization: string | undefined,
  body: unknown,
) {
  const presentedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const enrollmentToken = process.env.OUR_HOME_ENROLLMENT_TOKEN?.trim();
  const authorized = constantTimeTokenEqual(presentedToken, ingestToken)
    || Boolean(enrollmentToken && constantTimeTokenEqual(presentedToken, enrollmentToken));
  if (!authorized) throw new Error("Unauthorized");
  const input = phoneRegisterSchema.parse(body);
  await store.registerPhoneDevice(input);
  return {
    deviceId: input.deviceId,
    token: createDeviceToken(ingestToken, input.deviceId),
    appVersion: input.appVersion,
  };
}
