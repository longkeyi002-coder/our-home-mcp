# Visual Result → Care V0.1

Design references: `OH-44`, `OH-47`, `OH-65`, `OH-67`, `OH-69`, `OH-P1.5`, `OH-P2`.

This note records the implementation refinement that completes the separation between **looking** and **contacting the user**. It does not change the Design Constitution.

## Flow

```text
Presence / dwell
→ deterministic Curiosity eligibility
→ visual_opportunity Wake
→ Brain: ignore | request_visual
→ Android local Visual Privacy Guard + exact-session preflight
→ one ephemeral capture
→ structured visual_observation_summary
→ visual_result Wake
→ Brain: ignore | proactive_message
→ deterministic Delivery guard
→ FCM / notification when still appropriate
```

The first Brain decision answers only **whether one bounded look is worthwhile**. The second Brain decision answers only **whether the resulting structured context is worth contacting the user about**.

A completed observation never implies that a message must be sent.

## Visual-result eligibility

Runtime creates a `visual_result` Wake only when all of the following are true:

- the corresponding Runtime-issued `VisualRequestRecord` is `observed`;
- the structured summary is Earth evidence and is not legacy-unclassified;
- `requestId`, `deviceId`, `packageName`, and `sessionId` all match the approved request;
- the result is still within the 15-minute Care freshness window;
- no Wake already exists for `visual_result:<requestId>`.

The worker uses a read-only preflight first. With no eligible visual result, the normal worker cycle performs no extra JSON-store write for this feature.

## Brain contract

For `visual_result`, Brain may return only:

- `ignore`; or
- `proactive_message`.

It may not return `request_visual`. A new look must come from a later independent Curiosity opportunity and must pass the complete privacy/session path again.

The Brain receives only the persisted structured Life Context. Raw screenshot bytes are not added to the Wake, Runtime store, diagnostics, or Brain activation payload.

## Freshness and failure behavior

`visual_result` has a 15-minute freshness bound from the visual summary timestamp.

- Before Brain evaluation, an expired visual-result Wake is dismissed.
- Provider failure keeps the normal bounded Wake processing lease, preventing repeated calls every worker cycle.
- If the Wake becomes stale before a later retry, it is dismissed without calling Brain.
- If Brain already created a proactive candidate but notification delivery failed, the final Delivery guard suppresses the candidate once the visual result is stale. This prevents delayed messages that falsely sound like the AI has just seen the user's current screen.

Ordinary non-visual Care wakes retain their existing retry behavior.

## Automated protection

- `test/visual-result-wake.test.ts`
  - matching summary creates exactly one follow-up Wake;
  - mismatched App/session cannot create the Wake;
  - Brain makes a separate contact/ignore decision;
  - stale visual-result Wake does not call Brain;
  - failed notification is not delivered after visual context becomes stale.
- `test/hermes-visual-result-contract.test.ts`
  - Hermes receives the explicit separate-Care contract;
  - Hermes cannot turn `visual_result` into another visual request.

Real-device acceptance remains part of OH-P1.5 / OH-P2 and is not replaced by these tests.
