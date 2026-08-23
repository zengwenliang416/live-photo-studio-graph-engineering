# Quality Review: 003-worker-facts

## Verdict

needs-fix

## Separation Of Concerns

- The reported provider/renderer execution outside transactions, fact ownership,
  and correlated signal boundary preserve the intended separation between
  workers and Graph routing.

## Component Cohesion / Coupling

- Reusing provider and renderer ports plus deterministic identity helpers is
  cohesive. AI, media, contracts, and database test seams remain coupled
  through the shared dirty worktree and need a stable-snapshot review.

## Test Quality

- PostgreSQL-backed worker suites passed 5 and 6 tests respectively, with
  non-PostgreSQL suites also reported passing. The Node-version mismatch,
  ignored `sharp` build script, and absent production-runtime evidence leave
  important capability gaps.

## Error Handling

- Duplicate, cross-project, phase-preservation, and failure-idempotency cases
  are reported as covered. Real provider rejection, codec failure, and
  non-retryable error mapping remain unverified.

## Reuse / Duplication

- No duplicate worker phase helper or second provider/renderer abstraction was
  identified in the reviewed material. Existing ports and deterministic keys
  are reused.

## Complexity Delta

- Deterministic replay, ownership checks, fact persistence, and signal
  emission increase worker coordination complexity but keep routing out of the
  workers. External runtime gaps prevent measuring the remaining operational
  risk.

## Required Fixes

- Re-run the worker matrix in the supported Node and media runtime, including
  the required codec/HEIC checks.
- Bind the phase-ownership and duplicate/cross-project results to
  verification-owned receipts and complete the task checklist before approval.

## Stable Snapshot Revalidation (2026-08-23)

The worker suites now run with complete test discovery and pass their ordinary
and PostgreSQL cases. The review confirms that concurrent delivery claims
precede external provider/renderer calls and that ownership checks fail before
those calls.

**Verdict remains `needs-fix`** for real provider/codec/HEIC validation,
supported runtime evidence, and the documented post-crash stale-claim risk.
