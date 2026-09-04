import assert from "node:assert/strict";
import test from "node:test";
import { deriveRuntimeMessagingStatus } from "../src/runtime-messaging-status.js";

test("runtime messaging status reports no capability without configuration", () => {
  assert.deepEqual(deriveRuntimeMessagingStatus({}), {
    workerEnabled: false,
    notifier: "none",
    brain: "none",
    fcmConfigured: false,
    fcmCredentialsReadable: false,
  });
});

test("FCM takes notifier precedence and Hermes takes brain precedence", () => {
  assert.deepEqual(deriveRuntimeMessagingStatus({
    OUR_HOME_RUN_WORKER: "true",
    OUR_HOME_FIREBASE_PROJECT_ID: "project",
    GOOGLE_APPLICATION_CREDENTIALS: "/secret/service-account.json",
    OUR_HOME_NOTIFY_WEBHOOK_URL: "https://notify.example",
    OUR_HOME_HERMES_API_URL: "https://hermes.example",
    OUR_HOME_HERMES_API_KEY: "secret",
    OUR_HOME_DECISION_WEBHOOK_URL: "https://decision.example",
  }, () => true), {
    workerEnabled: true,
    notifier: "fcm",
    brain: "hermes",
    fcmConfigured: true,
    fcmCredentialsReadable: true,
  });
});

test("credential readability is distinct from environment configuration", () => {
  const env = {
    OUR_HOME_FIREBASE_PROJECT_ID: "project",
    GOOGLE_APPLICATION_CREDENTIALS: "/runtime/service-account.json",
  };
  assert.equal(deriveRuntimeMessagingStatus(env, () => true).fcmCredentialsReadable, true);
  assert.equal(deriveRuntimeMessagingStatus(env, () => false).fcmCredentialsReadable, false);
  assert.equal(deriveRuntimeMessagingStatus(env, () => false).fcmConfigured, true);
});

test("status never echoes secret configuration values", () => {
  const status = deriveRuntimeMessagingStatus({
    OUR_HOME_RUN_WORKER: "1",
    OUR_HOME_FIREBASE_PROJECT_ID: "private-project",
    GOOGLE_APPLICATION_CREDENTIALS: "/private/credentials.json",
    OUR_HOME_HERMES_API_URL: "https://private-hermes.example",
    OUR_HOME_HERMES_API_KEY: "private-key",
  }, () => true);
  const serialized = JSON.stringify(status);
  for (const secret of ["private-project", "/private/credentials.json", "private-hermes.example", "private-key"]) {
    assert.equal(serialized.includes(secret), false);
  }
});
