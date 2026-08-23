# Spec Review: 006-canary-validation

## Verdict

needs-fix

## Missing Requirements

- Canary thresholds, rollback commands, and final evidence under the owning
  runbook/ExecPlan surfaces are not complete in the current handoff.
- `pnpm db:migrate` is blocked by missing `DATABASE_URL`, and `pnpm graph:demo`
  fails because the human-review resume payload omits `correlationId`.
- Parent acceptance assertions A1, A2, and A3 remain `failing`; the
  verification runtime receipt is absent; and the task checklist remains
  incomplete.

## Extra Behavior

- No extra product or infrastructure behavior was introduced by this cleanup.
  The handoff records existing implementation claims without treating them as
  canary approval.

## Misunderstood Requirements

- The report does not claim the failed migration or demo as passing and keeps
  unsupported Redis, provider, codec, and device checks blocked. No direct
  requirement misunderstanding was identified.

## Cannot Verify From Diff

- This cleanup was intentionally not allowed to modify the runbook, ExecPlan,
  root documents, source, or external infrastructure, so those required
  surfaces cannot be verified here.
- Results are command-time self-reported evidence from a concurrently dirty
  worktree, not a verification-owned runtime receipt.
- The observed runtime is Node `v22.19.0` while the repository requires
  `>=24`; `sharp` build capability is also unverified.

## Acceptance Assertions Verified

- None. This task context declares no task-level acceptance assertion ids, and
  the parent acceptance contract remains failing.

## Required Fixes

- Complete the owning runbook, ExecPlan, and evidence artifacts without
  changing their scope through this cleanup.
- Correct and rerun the demo, run migration validation in an authorized
  environment, and capture supported-runtime results.
- Obtain verification-owned runtime status and task acceptance evidence before
  handoff approval.

## Stable Snapshot Revalidation (2026-08-23)

The repository validation set and Graph demo now pass, and the old migration/
demo failures are historical rather than current. The test runner glob was
corrected without weakening tests.

**Verdict remains `needs-fix`;** canary/rollback execution, supported runtime,
external services and SpecNav handoff evidence remain open.
