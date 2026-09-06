# Android Companion — Self Update V0.1

Status: IMPLEMENTING

## Goal

For the personal sideloaded Our Home Android Companion, remove the repeated manual "download the newest APK and find/install it" loop while preserving Android's installation security boundary.

```text
Stable build
→ signed APK + update manifest published to GitHub Release
→ Android periodic low-cost manifest check
→ versionCode newer?
→ background APK download
→ SHA-256 verification
→ local notification
→ user taps Install
→ Android package installer verifies package/signature and requests final confirmation
→ in-place upgrade
```

## Security and platform boundary

- The app MUST NOT attempt root/device-owner/shell based silent installation.
- A normal sideloaded Android app cannot silently replace itself. Final installation remains Android-controlled.
- All stable updates use the existing fixed signing key. Android therefore rejects an APK signed by a different key when replacing the installed package.
- Runtime additionally verifies the manifest-provided SHA-256 before presenting the APK for installation.
- Downloaded APK bytes stay in the app's private files area and are exposed to the package installer only through a `FileProvider` URI.
- No Runtime token, enrollment token or other secret is placed in the update manifest.

## Update manifest

The latest GitHub Release publishes `update.json`:

```json
{
  "schemaVersion": 1,
  "versionCode": 123,
  "versionName": "0.1.123",
  "apkUrl": "https://github.com/longkeyi002-coder/our-home-mcp/releases/download/android-stable-v0.1.123/our-home-android-stable.apk",
  "sha256": "...",
  "publishedAt": "..."
}
```

Rules:

- `schemaVersion` must be exactly `1`;
- `versionCode` must be positive and greater than installed `BuildConfig.VERSION_CODE` before any APK download occurs;
- `apkUrl` must be HTTPS and must resolve to the expected GitHub Releases host/path;
- `sha256` must be exactly 64 lowercase/uppercase hexadecimal characters;
- malformed manifests fail closed and retry later.

## Scheduling

- one WorkManager periodic check every 6 hours;
- network connectivity is required;
- application startup may enqueue one unique immediate check so a freshly opened app does not wait for the periodic window;
- WorkManager unique names prevent duplicate update loops;
- current version / no release / malformed manifest / transient network failure causes no user-facing spam.

## Download / install handoff

- only one version is downloaded at a time;
- download streams directly to a temporary file and is atomically promoted after SHA-256 verification;
- failed/hash-mismatched downloads are deleted;
- after a verified download, a notification says an update is ready;
- tapping it opens an internal update activity which launches Android's package installer using a `FileProvider` content URI;
- if Android requires "Install unknown apps" approval for Our Home, that remains an explicit OS-controlled user action.

## Release workflow

The stable APK workflow keeps the existing Actions artifact and additionally publishes/updates a GitHub Release containing:

- `our-home-android-stable.apk`
- `update.json`
- `signing-cert.txt`

Each Stable build keeps the existing `github.run_number` versionCode and fixed signing certificate. The release tag is version-specific so every manifest URL is immutable; GitHub's `/releases/latest/download/update.json` endpoint is the stable discovery URL used by the phone.

## Acceptance

Automated:

1. old/equal version does not download;
2. newer valid manifest is accepted;
3. malformed hash / non-HTTPS / non-GitHub release URL fails closed;
4. downloaded bytes must match SHA-256;
5. periodic/immediate work is unique and bounded;
6. Android CI test/lint/assemble succeeds;
7. stable workflow creates manifest from the same version values used to compile the APK.

Real device:

1. install Stable N;
2. publish Stable N+1 signed with the same key;
3. phone detects and downloads N+1 without manually retrieving the APK;
4. tapping the update notification reaches Android's installer;
5. N+1 upgrades N in place without uninstalling the app or losing Our Home data/permissions;
6. a mismatched-signature APK cannot replace the installed app.
