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

export function normalizeEnrollmentToken(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function assertPhoneTokenSeparation(
  ingestToken: string | undefined,
  enrollmentToken: string | undefined,
): void {
  const normalizedIngest = ingestToken?.trim();
  const normalizedEnrollment = normalizeEnrollmentToken(enrollmentToken);
  if (
    normalizedIngest
    && normalizedEnrollment
    && constantTimeTokenEqual(normalizedEnrollment, normalizedIngest)
  ) {
    throw new Error("OUR_HOME_ENROLLMENT_TOKEN must differ from OUR_HOME_INGEST_TOKEN");
  }
}

// OH-P1/OH-42: fail closed at process startup if the register-only credential
// is accidentally configured to the same value as the high-privilege ingest secret.
assertPhoneTokenSeparation(
  process.env.OUR_HOME_INGEST_TOKEN,
  process.env.OUR_HOME_ENROLLMENT_TOKEN,
);

/** Check if presented token matches any of the valid tokens */
function matchesAnyToken(presentedToken: string | undefined, validTokens: string[]): boolean {
  return validTokens.some((token) => constantTimeTokenEqual(presentedToken, token));
}

export async function registerPhone(
  store: JsonStore,
  ingestToken: string,
  authorization: string | undefined,
  body: unknown,
  enrollmentToken?: string,
) {
  const input = phoneRegisterSchema.parse(body);
  const presentedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const normalizedEnrollmentToken = normalizeEnrollmentToken(enrollmentToken);

  // Initial enrollment accepts the register-only credential (or the ingest secret for
  // backward-compatible operations). Once enrolled, a phone may also use its own
  // device-scoped token to refresh appVersion / FCM address for this exact deviceId.
  // The device token is an HMAC bound to input.deviceId, so it cannot update another device.
  const validTokens = [
    ingestToken,
    ...(normalizedEnrollmentToken ? [normalizedEnrollmentToken] : []),
    createDeviceToken(ingestToken, input.deviceId),
  ];
  if (!matchesAnyToken(presentedToken, validTokens)) throw new Error("Unauthorized");

  await store.registerPhoneDevice(input);
  return {
    deviceId: input.deviceId,
    token: createDeviceToken(ingestToken, input.deviceId),
    appVersion: input.appVersion,
  };
}
