# OH-P2 Proactive Messaging — Real-device Runbook

Design references: `OH-40`, `OH-47`, `OH-63`, `OH-64`, `OH-65`, `OH-66`, `OH-P2`.

## Goal

Prove the real end-to-end path without adding a special test-only push endpoint:

```text
Hermes / Brain decision
  -> Runtime proactive candidate
  -> embedded Life Loop
  -> FCM HTTP v1
  -> Android FirebaseMessagingService
  -> Our Home system notification
  -> user taps notification
  -> intended conversation destination
```

The final meaning of the `/chat` destination is intentionally not frozen by this runbook. The product owner is confirming with Hermes whether it must reopen the exact Hermes conversation, the Hermes dashboard Chat, or another shared Our Home conversation surface. Until that decision is recorded, Android may use the current internal message landing page only as a provisional destination.

## Server prerequisites

The Runtime must have exactly one data-file owner and run with the embedded worker enabled.

Required for the normal phone/runtime path:

- `OUR_HOME_RUN_WORKER=true`
- `OUR_HOME_MCP_TOKEN`
- `OUR_HOME_INGEST_TOKEN`
- `OUR_HOME_ENROLLMENT_TOKEN` for Android enrollment

Required for direct FCM delivery:

- `OUR_HOME_FIREBASE_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to the Firebase service-account JSON on the Runtime host

Required for automatic Wake -> Brain decisions, choose one:

- Hermes: `OUR_HOME_HERMES_API_URL` + `OUR_HOME_HERMES_API_KEY`
- Generic decision webhook: `OUR_HOME_DECISION_WEBHOOK_URL` (+ optional token)

Secrets and credential paths must never be copied into diagnostics, logs, GitHub issues, or screenshots.

## Stable Android APK prerequisites

The user-installable Stable APK now requires all of the following secrets:

- stable signing secrets
- `OUR_HOME_ENROLLMENT_TOKEN`
- `GOOGLE_SERVICES_JSON_B64`

The Stable workflow validates that the restored Firebase config targets package `com.hermes.companion`. A Stable APK without Firebase configuration is no longer considered a valid P2 build.

## Layer 1 — Android push registration

After installing/updating the Stable APK:

1. Open Our Home once.
2. Allow system notifications.
3. Let the device register with Runtime.
4. Push registration must become `registered`.
5. The Home status may show "主动消息 已开启" only when both notification permission and push registration are healthy.

Advanced Diagnostics must expose, without exposing the token:

- push registration state
- last registration attempt
- last registration success
- last registration error

## Layer 2 — Runtime capability status

Call authenticated `GET /v1/phone/status` with the MCP/admin token.

Expected for a complete FCM + Hermes deployment:

```json
{
  "messaging": {
    "workerEnabled": true,
    "notifier": "fcm",
    "brain": "hermes",
    "fcmConfigured": true
  },
  "devices": [
    {
      "hasPushAddress": true
    }
  ]
}
```

A generic decision webhook may report `brain: "webhook"` instead. The endpoint reports only capability categories and booleans; it must never return project ids, credential paths, URLs, tokens, or API keys.

## Layer 3 — Notifier-only proof

Use the existing MCP tool `home.schedule_proactive_message` with a due time at or just before now.

This deliberately exercises the production proactive queue and notifier. Do not add a separate `/test-push` HTTP endpoint.

Acceptance:

- one candidate is persisted;
- one Life Loop cycle claims it;
- one data-only, Android HIGH-priority FCM message is sent;
- candidate becomes `delivered` only after FCM HTTP success;
- on failure it remains pending and follows bounded exponential retry;
- Android displays exactly one user notification.

## Layer 4 — Wake + Brain proof

After notifier-only delivery works, prove the full autonomous path with a real life-state transition that creates a Wake Event.

Acceptance:

- Wake Event is persisted;
- Brain is called once for the claimed event;
- failed Brain calls retain the five-minute processing lease before retry;
- successful `proactive_message` decisions atomically create one candidate and mark the Wake Event handled;
- retry cannot create a duplicate candidate for the same Wake Event;
- notifier delivers the candidate through the same FCM path as Layer 3.

## Layer 5 — background notification behavior

Put Our Home in the background before delivery.

The Runtime sends data-only FCM with Android `HIGH` priority. Android's `FirebaseMessagingService` must create the notification itself so the app controls the tap destination instead of Google Play services creating a default Launcher notification.

Acceptance:

- the system notification is visible while the app is backgrounded;
- title/body come from the proactive candidate;
- tapping the notification does not silently fall back to the settings/home dashboard;
- the destination carries the candidate/message identity needed to continue from that message;
- the final conversation target must be re-validated after Hermes confirms the Chat definition.

## Failure localization

| Symptom | First thing to inspect |
| --- | --- |
| Telemetry works, no push token | Android Push Registration diagnostics / Firebase Android config |
| Push registration is `error` | last push registration error; Runtime registration/auth |
| `hasPushAddress=false` | Android registration did not reach Runtime |
| `notifier=none` | Runtime FCM/webhook configuration missing |
| `fcmConfigured=false` | project id or service-account credential path missing |
| `workerEnabled=false` | Runtime started without embedded Life Loop |
| `brain=none` | no Hermes or decision webhook configured; notifier-only test can still work |
| Candidate remains pending | notifier error/backoff; inspect Runtime logs without secrets |
| Notification appears but tap goes to wrong place | Android notification destination routing; re-check Hermes Chat decision |

## P2 completion gate

P2 proactive messaging is not complete until one real Android device proves all of the following on the same build/deployment:

- Stable APK contains Firebase config and keeps stable signing identity;
- Android push registration is `registered`;
- Runtime reports `workerEnabled=true`, `notifier=fcm`, `fcmConfigured=true`, and a device `hasPushAddress=true`;
- notifier-only proactive candidate reaches the backgrounded phone exactly once;
- a real Wake + Brain decision reaches the phone exactly once;
- notification tap reaches the agreed conversation destination;
- retry, timeout, cooldown, and diagnostic behavior remain correct.
