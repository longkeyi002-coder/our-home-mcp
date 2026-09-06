# Quiet Hours V0.1 — Care Delivery Foundation

Design references: `OH-40`, `OH-47`, `OH-64`, `OH-65`, `OH-P2`.

## Purpose

Quiet Hours is a deterministic Runtime delivery guard. Brain may decide that a proactive message is worthwhile, but final notification timing remains governed by Runtime policy.

This V0.1 step is intentionally a **deployment-level foundation**, not the final user-facing preference UI. It defaults to disabled. A later Android / Our Home settings surface can replace the environment configuration without changing the final delivery boundary.

## Runtime configuration

Quiet Hours is enabled only when all three values are present:

- `OUR_HOME_QUIET_HOURS_START` — local `HH:MM`;
- `OUR_HOME_QUIET_HOURS_END` — local `HH:MM`;
- `OUR_HOME_QUIET_HOURS_TIMEZONE` — IANA timezone, for example `Asia/Taipei`.

Optional:

- `OUR_HOME_QUIET_HOURS_WEEKDAYS` — comma-separated local weekdays, `0=Sunday ... 6=Saturday`; default is every day;
- `OUR_HOME_QUIET_HOURS_ALLOW_HIGH_PRIORITY` — `true` by default. When true, only a proactive candidate linked to a `high` priority Wake may bypass Quiet Hours.

Partial or invalid configuration fails fast when the Runtime worker starts. The policy contains no token or secret.

## Delivery semantics

```text
Brain / MCP creates proactive candidate
→ candidate becomes due
→ stale/session/cooldown checks
→ Quiet Hours guard
→ deliver now OR defer dueAt
→ notifier / FCM
```

Rules:

1. Quiet Hours never changes whether Brain was allowed to think or whether a Wake existed; it only controls final user-visible delivery timing.
2. Normal/low-priority messages due during Quiet Hours remain `pending` and their `dueAt` is moved to the first minute outside the quiet window.
3. The worker clears the processing claim while deferring, so the candidate is not stuck in a lease.
4. The candidate is not retried every worker minute while quiet; `claimDueProactiveMessages()` ignores it until the deferred `dueAt`.
5. A high-priority Wake bypasses only when `OUR_HOME_QUIET_HOURS_ALLOW_HIGH_PRIORITY=true`.
6. Cross-midnight windows treat the after-midnight portion as belonging to the weekday on which the quiet window started. Example: Monday `23:00 → 07:00` includes Tuesday 02:00.
7. Timezone evaluation uses `Intl.DateTimeFormat`, so Runtime follows IANA timezone/DST rules instead of fixed UTC offsets.
8. Existing Care cooldown with a `nextAvailableAt` is also deferred rather than incorrectly dismissed.
9. Stale long-dwell and stale visual-result messages are still discarded before Quiet Hours. A deferred visual-result message that becomes stale before delivery is discarded at its next delivery check.

## Non-goals

This step does not yet add:

- Android UI for editing Quiet Hours;
- per-message snooze controls;
- separate weekday/weekend UI presets;
- calendar-aware Do Not Disturb;
- OS notification-channel DND bypass;
- a new Brain action for overriding Quiet Hours.

Brain must not receive an override capability for this policy.

## Automated protection

`test/quiet-hours.test.ts` covers:

- disabled-by-default behavior;
- incomplete configuration rejection;
- cross-midnight deferral;
- weekday ownership across midnight;
- explicit high-priority bypass control;
- worker-level pending → deferred → delivered lifecycle.
