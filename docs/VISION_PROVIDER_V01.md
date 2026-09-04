# Our Home — Vision Provider V0.1

Status: IN PROGRESS

Related: `docs/OH_PRESENCE_VISUAL_PLAN.md`, OH-42, OH-45, OH-69, Issue #25.

## Default provider

V0.1 presets Zhipu AI as the default visual understanding provider because it currently exposes a free visual model suitable for low-frequency screen context classification.

- Base URL: `https://open.bigmodel.cn/api/paas/v4/`
- Endpoint: `chat/completions`
- Default model: `glm-4.6v-flash`
- Authentication: user-supplied Bearer API key
- Thinking: disabled for this coarse classification task
- Stream: disabled

The provider remains replaceable. Runtime and privacy policy must not depend on Zhipu-specific behavior.

Official references:

- https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash
- https://docs.bigmodel.cn/cn/guide/capabilities/thinking

## Credential boundary

- The user enters the vision token on Android.
- The token is encrypted with Android Keystore-backed AES-GCM storage.
- The plaintext token must never enter BuildConfig, Runtime observations, diagnostics, logs, FCM payloads, or GitHub.
- UI may expose only `configured / not configured`; it must not read the saved token back into a text field.
- Removing the token also disables visual observation.

## Screenshot boundary

```text
Android Sensitive Guard
        ↓ allowed only
Ephemeral screenshot in memory
        ↓ HTTPS
User-selected Vision Provider
        ↓
Bounded structured summary
        ↓
Our Home Runtime
```

The raw screenshot must not transit Our Home Runtime.

The screenshot is memory-only and is cleared after every provider success/failure path. Secure Window, lock state, stale App/session, `NEVER`, PRIVATE/PROTECTED consent rules and temporary-grant expiry remain authoritative before capture.

## Provider prompt boundary

The provider is asked only for coarse activity/context. It must be instructed not to OCR, quote, summarize, or repeat messages, names, usernames, phone/account/card numbers, passwords, PINs, OTP/verification codes, payment details, notification text, addresses, identifiers, or other private text.

Expected normalized result:

```json
{
  "activity": "gaming",
  "content": "generic battle scene",
  "confidence": 0.91
}
```

Allowed V0.1 activity values are deliberately coarse: `gaming`, `video`, `social`, `shopping`, `work`, `reading`, `navigation`, `other`, `unknown`.

## Activation rule

Saving provider configuration does not enable visual observation. Visual observation is a separate explicit user choice. Curiosity may only propose a glance after it is enabled; Android Sensitive Guard still has final veto authority.
