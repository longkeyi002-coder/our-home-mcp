import { accessSync, constants } from "node:fs";

export type RuntimeNotifierKind = "fcm" | "webhook" | "none";
export type RuntimeBrainKind = "hermes" | "webhook" | "none";

export interface RuntimeMessagingStatus {
  workerEnabled: boolean;
  notifier: RuntimeNotifierKind;
  brain: RuntimeBrainKind;
  fcmConfigured: boolean;
  fcmCredentialsReadable: boolean;
}

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function defaultCanRead(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Non-secret P2 capability summary for authenticated diagnostics.
 * It intentionally reports only whether required configuration exists and the
 * configured credential file is readable; it never returns paths, tokens,
 * project ids, webhook URLs, or API keys.
 */
export function deriveRuntimeMessagingStatus(
  env: NodeJS.ProcessEnv,
  canRead: (path: string) => boolean = defaultCanRead,
): RuntimeMessagingStatus {
  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const fcmConfigured = Boolean(env.OUR_HOME_FIREBASE_PROJECT_ID?.trim() && credentialsPath);
  const fcmCredentialsReadable = Boolean(fcmConfigured && credentialsPath && canRead(credentialsPath));
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
    fcmCredentialsReadable,
  };
}
