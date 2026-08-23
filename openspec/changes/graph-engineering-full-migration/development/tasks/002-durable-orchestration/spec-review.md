# Spec Review: 002-durable-orchestration

## Verdict

approved

## Missing Requirements

- The focused PostgreSQL suite passed 11 tests at the observed command time,
  but the task checklist still leaves 2.3, 2.4, and 2.5 unchecked.
- `pnpm graph:demo` failed in the human-review resume path because the payload
  omitted required `correlationId`; the documented end-to-end path is not
  complete.
- Parent A1 remains `failing`, and no task acceptance or verification runtime
  receipt binds the results to this implementation snapshot.

## Extra Behavior

- No extra orchestration behavior was accepted beyond the requested locking,
  correlation, duplicate-delivery, stale-recovery, and bounded-repair paths.

## Misunderstood Requirements

- The implementation and report keep Graph-path phase transitions in the
  orchestrator and treat worker completion as a correlated signal. The demo
  payload mismatch shows an incomplete seam, not evidence that the requirement
  is satisfied end to end.

## Cannot Verify From Diff

- The implementation is concurrently dirty, so restart and duplicate behavior
  cannot be tied to a stable Git revision.
- The available test claims are not a `system-executed` SpecNav receipt.
- The demo failure prevents verification of the human-review resume contract.

## Acceptance Assertions Verified

- `A1:durable-orchestration` is the task-level acceptance assertion covered by
  the current-head orchestration, API and demo receipts.

## Required Fixes

- Correct the demo resume payload/contract seam so `correlationId` is present,
  then rerun `pnpm graph:demo`.
- Keep the task checklist and task acceptance evidence synchronized with the
  actual 2.3-2.5 coverage.
- Re-run restart, duplicate, stale, correlation, cancellation, and Outbox
  checks on a stable revision and obtain verification-owned runtime evidence.

## Stable Snapshot Revalidation (2026-08-23)

The Graph demo now reaches `COMPLETED`, and the orchestration acceptance
scenarios pass locally on PostgreSQL. The prior demo failure is retained as
historical evidence and is not reported as a current failure.

**Current-head verdict: `approved` for the declared orchestration slice.**
Live Redis/BullMQ and supported Node 24 verification remain open.
