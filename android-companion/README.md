# AI Life Companion — Android

Android Companion is the Earth-side sensor and notification client for AI Life Runtime.

It is **not tied to Hermes**. The current Android package/class names still contain `hermes` for compatibility with the existing app/Firebase setup; that is a migration detail, not the architecture boundary.

## Responsibilities

Android Companion has three separate planes.

### 1. Telemetry Plane

```text
Battery / Charging / Connectivity / Usage
→ local Room queue
→ WorkManager
→ HTTPS Runtime ingest
```

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

- HTTPS Runtime telemetry
- device registration + device-scoped credential
- Android Keystore token storage
- optional build-time default Runtime URL
- register-only enrollment token for private auto-configured builds
- first-launch automatic registration when defaults are present
- manual Runtime/token settings only as a failed-auto-connect fallback
- battery / charging / connectivity heartbeat
- UsageStats foreground package summary with user-granted Usage Access
- fresh recent-app fallback when UsageEvents has no active session
- Usage Timeline summary
- manual status observations
- Room pending queue
- WorkManager retry + immediate worker + approximate 15-minute periodic collection
- duplicate event protection
- staged registration/upload error diagnostics
- separate periodic/immediate worker diagnostics
- copyable secret-redacted diagnostic report
- FCM registration / notification handling

## Auto configuration

A private user build can be created with:

- `OUR_HOME_DEFAULT_RUNTIME_URL`
- `OUR_HOME_ENROLLMENT_TOKEN`

These values are injected at build time. The repository contains no real value.

On first launch:

```text
no local config
→ apply default Runtime
→ register-only enrollment token
→ /v1/phone/register
→ receive device token
→ save device token in Android Keystore
→ normal telemetry uses device token
```

The enrollment token is deliberately lower privilege than `OUR_HOME_INGEST_TOKEN`: it can register devices but cannot directly call heartbeat, observations or MCP. `OUR_HOME_MCP_TOKEN` must never enter the Android APK.

An existing explicit custom Runtime is never overwritten by build defaults.

QR enrollment and LAN mDNS discovery are tracked as later fallbacks in Issue #24.

## Diagnostics

The diagnostics panel distinguishes:

- periodic worker state;
- immediate upload worker state;
- last automatic worker run;
- last periodic collection;
- last successful upload;
- manual heartbeat attempt time;
- pending event count;
- registration/device credential presence flags;
- Usage Access / usage availability;
- foreground package;
- staged API error such as `registration HTTP 401 — token rejected`.

“复制诊断信息” copies the same non-secret state. Token values are never copied, and Runtime URL query/fragment data are redacted.

`Last periodic collection: never` does **not** mean all background work is broken. An immediate worker may already have run; use `Last worker run` and `Immediate upload worker` to distinguish them.

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

QR enrollment, when implemented, may request camera permission only after the user explicitly chooses Scan; it will not be a background permission.

## Build validation

Requirements:

- JDK 17
- Android SDK 35

```bash
cd android-companion
./gradlew :app:test :app:lint :app:assembleDebug
```

`.github/workflows/android-companion.yml` performs source validation only. Its runner-local debug signing identity is intentionally **not** treated as a user-installable release identity and the workflow does not publish an APK.

## Stable user-installable APK

Use `.github/workflows/android-stable-apk.yml` (`Our Home Android Stable APK`). It requires secrets/config for:

- fixed signing keystore + passwords/alias;
- default Runtime URL;
- register-only enrollment token.

The workflow sets an increasing `versionCode`, builds with the fixed keystore, verifies the APK with `apksigner`, records the signer certificate SHA-256, and uploads the stable APK artifact.

Once a fixed signing key is established, **never rotate it casually**. Future APKs must use the same signing identity so Android can upgrade in place and retain app data/permissions.

If the phone currently has a historical GitHub-runner debug APK whose private signing key no longer exists, cryptography does not permit creating a matching update. One migration to the fixed signing key may be necessary; after that, further upgrades must not require uninstalling again.

## Firebase

For a Firebase-enabled local build, provide `android-companion/app/google-services.json` (gitignored). The stable APK workflow also restores `GOOGLE_SERVICES_JSON_B64` when configured.

`.github/workflows/android-firebase-apk.yml` is validation-only and intentionally does not publish a randomly signed user APK.

## Truth boundary

Android observations are Earth-side evidence.

Runtime persists them as observed facts only when actually read from Android/system APIs. Missing permission or missing data remains unknown; the app must not invent a value.

User-entered manual states are user declarations, not independent sensor verification. AI World events are never produced by this Android client.

## Background behavior

WorkManager is not an exact realtime scheduler. Android/Doze/vendor power policies may delay periodic work. V0.1 promises **eventual low-cost telemetry**, not second-by-second continuous tracking.

If Usage Access is unavailable, periodic heartbeat can still report battery/charging/connectivity while usage data remains absent.

## Product UI direction

The app should answer four questions clearly:

1. Is Runtime actually authenticated and usable?
2. What real phone state does Runtime currently know?
3. What did Runtime/AI recently do?
4. What is the AI currently doing in its own virtual life?

A successful `/healthz` alone is not “Connected”; Android connection success requires real registration/device authentication. `WebSocket onOpen` alone must also never be displayed as “AI connected”.
