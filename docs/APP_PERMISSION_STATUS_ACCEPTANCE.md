# App permissions and live status

Design Reference: OH-43, OH-45, OH-46, OH-68; OH_PRESENCE_VISUAL_PLAN Stage 2 / Stage 6.

The permission inventory contains launcher apps and locally saved policy packages, with no recent-use requirement or count limit. Saved packages without a launcher entry remain editable and are labeled accordingly; this is not evidence that they are still installed. Inventory enumeration runs off the UI thread when opening the controls. Changing a switch or receiving an app transition does not rescan the package manager.

Home separates the live sensing service from permission settings. A granted accessibility permission alone cannot produce a live or screen-off claim. Local presence changes update the UI through a preferences listener without model calls or network polling. The screen-observation indicator exposes an in-memory active state only after the existing notification is posted and clears it at observation completion. Enabling visual observation alone does not display “正在观察”.

## Verification

- Unit tests cover 125 unused launcher apps, saved packages missing a launcher, duplicate package identity, disconnected sensing, permission revocation, lock and screen-off states.
- On a physical phone, open permissions before using a newly installed app; verify it is searchable. Close and reopen the sheet after installation to refresh.
- Save a policy, then disable/remove the launcher entry; verify the saved setting remains editable and is labeled as lacking a launcher.
- Switch apps, lock/unlock, and disable/re-enable the sensing service; return to Home and verify current service/screen state. Test split-screen transitions while Home remains visible.
- Enable visual permission without requesting capture: Home must say “未在观察”. During an authorized capture/provider request, Home and the existing notification must indicate active observation, and return to idle on success or failure.
- Repeat the existing hidden-app/queued-upload privacy acceptance tests. App inventory remains local; this change does not grant any additional app or action permissions.

Android package visibility reference: https://developer.android.com/training/package-visibility/declaring

Physical-device validation remains required, especially for work profiles and OEM-hidden apps; launcher enumeration does not claim access across Android profile boundaries.
