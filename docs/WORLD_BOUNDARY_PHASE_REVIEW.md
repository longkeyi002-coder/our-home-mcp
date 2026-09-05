# World/provenance prerequisite review

Design Reference: OH-30, OH-31, OH-32, OH-43, OH-44, OH-66; issue #26 and the OH-P3 start gate.

## Implemented

- Integrates the observation-boundary work from `feat/world-provenance-boundary` at `86aeea9` into the latest app-privacy line without replacing the intervening privacy changes.
- Observation schema v3 stores world, provenance and optional evidence references. Legacy v1/v2 data is migrated deterministically on load and saved as v3 on the next successful store mutation. Ambiguous system/mock records remain explicitly unclassified and cannot drive Earth facts. Existing files are not overwritten on a read-only open.
- Invalid enum values, partial boundaries, illegal world/provenance pairs and contradictory Earth source/confidence combinations are rejected. V3 records missing the mandatory boundary are rejected rather than silently migrated.
- Earth state, bounded Brain observation context, semantic understanding, visual request generation, visual budget and phone liveness isolate the world boundary. Earth inferences may enter the explicitly labeled Brain context but cannot become observed device facts.
- Deduplication and hourly usage compaction include world/provenance so virtual records cannot replace real phone evidence.
- Phone HTTP routes reject explicit non-Earth payloads and stamp their own Earth/observed boundary. MCP accepts explicit valid worlds and rejects illegal pairs. Store-generated observation IDs cannot be overwritten by an extra input field.
- Pending v2 wake decisions and their pending notification candidates are dismissed during migration because their old embedded state was derived before world filtering. History remains; ordinary manually scheduled candidates remain pending. The wake baseline resets for fresh derivation.

## Verification

`npm test`: TypeScript build passed; 136 tests passed, zero failures. Tests cover actual compiled local HTTP ingest, MCP, persistence round trips, cross-world consumers, duplicate keys, unknown boundaries and legacy pending decisions. Dependencies match the lockfile versions: TypeScript 6.0.3, tsx 4.20.6, zod 4.5.4, MCP SDK 1.30.0.

Android app-permission/status changes are preserved from the parent branch. No APK release, production deployment or model/provider request is part of this phase. This submission skips GitHub CI at the user's request to defer APK building; backend checks were run locally.

## Scope and remaining gate

This is the observation-data prerequisite for AI World, not a claim that OH-P3 is implemented or that issue #26 has been fully closed. Legacy diary/activity/action domains still use their older source labels; before admitting them to canonical AI World memory, give those records explicit provenance and a reviewed migration. No AI World persisted state has been added ahead of that requirement. Real-phone P1/P2 acceptance remains a separate outstanding gate.

The next bounded step is the legacy long-lived-record boundary review/migration required by OH-30/OH-31, followed by OH-P3's persistent world state and deterministic progression.
