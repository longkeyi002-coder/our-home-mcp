# AI Life Companion — Android

Android Companion is the Earth-side sensor and notification client for AI Life Runtime.

It is **not tied to Hermes**. The current Android package/class names still contain `hermes` for compatibility with the existing app/Firebase setup; that is a migration detail, not the architecture boundary.

## Responsibilities

Android Companion does three separate jobs.

### 1. Telemetry Plane

```text
Battery / Charging / Connectivity / Usage
→ local Room queue
→ WorkManager
→ HTTPS Runtime ingest
```

This is how Runtime continuously learns low-cost summaries of the user's real phone state.

### 2. Control Plane

Planned migration from the validated experiment branch:

```text
Remote client
→ Relay
→ Android outbound WSS
→ Local MCP
```

This is only for on-demand device reads/actions. It is not the main life-sensing mechanism.

### 3. Delivery Plane

```text
Runtime
→ FCM
→ Android system notification
```

A temporary WebSocket disconnect must not prevent proactive notifications.

## Current implemented baseline

- configurable HTTPS Runtime URL
- device registration + derived device credential
- Android Keystore token storage
- battery / charging / connectivity heartbeat
- UsageStats foreground package summary (with user-granted Usage Access)
- Usage Timeline summary
- manual status observations
- Room pending queue
- WorkManager retry and 15-minute periodic collection
- duplicate event protection
- diagnostics state
- FCM registration / notification handling

## Permissions

Currently requested:

- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `POST_NOTIFICATIONS`
- Usage Access (user explicitly grants it in Android Settings)

Not requested in V0.1:

- location
- Accessibility
- screenshots
- camera
- microphone
- contacts
- SMS
- private notification/chat contents

## Build

Requirements:

- JDK 17
- Android SDK 35

```bash
cd android-companion
./gradlew :app:test :app:lint :app:assembleDebug
```

APK:

```text
app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions workflow: `.github/workflows/android-companion.yml`.

## Firebase

For a Firebase-enabled local build, provide your own `android-companion/app/google-services.json` (gitignored).

A manual GitHub workflow also exists for repository-secret-backed Firebase APK builds. Firebase credentials/service-account material must never be committed.

## Truth boundary

Android observations are Earth-side evidence.

Runtime should persist them as observed facts only when they were actually read from Android/system APIs. Missing permission or missing data must remain unknown; the app must not invent a value.

User-entered manual states are user declarations, not independent sensor verification.

AI World events are never produced by this Android client.

## Background behavior

WorkManager is not an exact realtime scheduler. Android/Doze/vendor power policies may delay periodic work. V0.1 therefore promises **eventual low-cost telemetry**, not second-by-second continuous tracking.

If Usage Access is unavailable, periodic heartbeat can still report battery/charging/connectivity while usage data remains absent.

## Product UI direction

The rebuilt app should answer four questions clearly:

1. Is Runtime reachable?
2. What real phone state does Runtime currently know?
3. What did the Runtime/AI recently do?
4. What is the AI currently doing in its own virtual life?

Connection state must distinguish Runtime connectivity, realtime relay connectivity and actual last successful exchange. `WebSocket onOpen` alone must never be displayed as “AI connected”.
