import { access } from "node:fs/promises";

export type RuntimeNotifierKind = "fcm" | "webhook" | "none";
export type RuntimeBrainKind = "hermes" | "webhook" | "none";

export interface RuntimeMessagingStatus {
  workerEnabled: boolean;
  notifier: RuntimeNotifierKind;
  brain: RuntimeBrainKind;
  fcmConfigured: boolean;
}

export interface ProbedRuntimeMessagingStatus extends RuntimeMessagingStatus {
  fcmCredentialsReadable: boolean;
}

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/**
 * Non-secret P2 capability summary for authenticated diagnostics.
 * It intentionally reports only whether required configuration exists, never
 * credential paths, tokens, project ids, webhook URLs, or API keys.
 */
export function deriveRuntimeMessagingStatus(env: NodeJS.ProcessEnv): RuntimeMessagingStatus {
  const fcmConfigured = Boolean(env.OUR_HOME_FIREBASE_PROJECT_ID?.trim() && env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  const notifier: RuntimeNotifierKind = fcmConfigured
    ? "fcm"
    : env.OUR_HOME_NOTIFY_WEBHOOK_URL?.trim()
      ? "webhook"
      : "none";

  const brain: RuntimeBrainKind = env.OUR_HOME_HERMES_API_URL?.trim() && env.OUR_HOME_HERMES_API_KEY?.trim()
    ? "hermes"
    : env.OUR_HOME_DECISION_WEBHOOK_URL?.trim()
      ? "webhook"
      : "none";

  return {
    workerEnabled: enabled(env.OUR_HOME_RUN_WORKER),
    notifier,
    brain,
    fcmConfigured,
  };
}

export async function probeRuntimeMessagingStatus(
  env: NodeJS.ProcessEnv,
  accessFile: (path: string) => Promise<unknown> = access,
): Promise<ProbedRuntimeMessagingStatus> {
  const status = deriveRuntimeMessagingStatus(env);
  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  let fcmCredentialsReadable = false;
  if (status.fcmConfigured && credentialsPath) {
    try {
      await accessFile(credentialsPath);
      fcmCredentialsReadable = true;
    } catch {
      fcmCredentialsReadable = false;
    }
  }
  return { ...status, fcmCredentialsReadable };
}
