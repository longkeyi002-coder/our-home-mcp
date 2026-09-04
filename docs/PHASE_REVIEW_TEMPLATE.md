# Our Home — Phase Design Review Template

> Copy this checklist into the Phase completion Issue/PR. A Phase is not complete until this review is filled in.

## Phase

Phase:

Design References:

## 1. Product alignment

- [ ] Implemented behavior matches the referenced design sections.
- [ ] No design-external feature was added silently.
- [ ] The user-facing behavior still matches the intended companion relationship.
- [ ] AI autonomy did not reduce user control.

Notes:

## 2. World / truth alignment

- [ ] Earth / AI World / Fiction remain separated.
- [ ] Observed / user-declared / inferred / simulated data remain distinguishable.
- [ ] Inference is not promoted to fact without evidence.
- [ ] AI World facts cannot answer Earth factual questions.

Notes:

## 3. Technical alignment

- [ ] Runtime Core remains provider-neutral.
- [ ] Telemetry, remote-control, and delivery responsibilities remain separated.
- [ ] Retry / dedupe / ordering / idempotency are addressed where relevant.
- [ ] Failure of one provider/tool does not stop unrelated Runtime life.

Notes:

## 4. User control / privacy / safety

- [ ] Required permissions are minimal.
- [ ] Sensitive collection is opt-in / on-demand where required.
- [ ] External side effects follow action risk levels.
- [ ] The user can revoke/disable/correct relevant behavior.

Notes:

## 5. Cost

- [ ] Deterministic work stays in Runtime rather than unnecessary model calls.
- [ ] New recurring model calls have a clear budget/frequency policy.
- [ ] External API or generation cost is observable.

Notes:

## 6. Tests from design

- [ ] `docs/DESIGN_TEST_MATRIX.md` is updated.
- [ ] Key design invariants have automated tests.
- [ ] Real-device/manual acceptance is documented where automation is insufficient.
- [ ] Regression tests exist for bugs found during the Phase.

Notes:

## 7. Documentation

- [ ] `OUR_HOME_DESIGN.md` still matches actual intended behavior.
- [ ] README/architecture/roadmap do not contradict the Design Constitution.
- [ ] New capability names are provider-neutral unless they are adapter-specific.

Notes:

## Review result

- [ ] PASS — Phase can be marked complete.
- [ ] FAIL — return to implementation/design update.

Open deviations / follow-ups:
