# Spec Review: 001-existing-graph-foundation

## Verdict

needs-fix

## Missing Requirements

- The focused contract, runtime, API, and TypeScript checks provide partial
  evidence, but `pnpm db:migrate` stopped before database connection because
  `DATABASE_URL` was unset. Additive migration application and reapplication
  are therefore not verified.
- The parent acceptance assertions A1, A2, and A3 remain `failing`, and no
  task-level acceptance receipt or verification runtime receipt is available.
- The shared implementation worktree is still being changed by another
  thread, so the foundation cannot be accepted against a stable revision.

## Extra Behavior

- No clearly out-of-scope foundation behavior was credited from the reviewed
  material. Observability, web, worker, and canary claims are treated as
  separate task slices rather than evidence that closes this task.

## Misunderstood Requirements

- No direct misunderstanding of the immutable graph binding, typed contract,
  or API Outbox boundary was identified. The remaining issue is evidence
  completeness, not permission to infer migration success from a build.

## Cannot Verify From Diff

- A current immutable Git head cannot be identified because implementation
  files are concurrently dirty.
- The repository requires Node `>=24`, while the observed runtime was
  `v22.19.0`; current checks therefore do not establish supported-runtime
  behavior.
- The available test results are command-time claims without a
  `system-executed` validation receipt.

## Acceptance Assertions Verified

- None. This task context declares no task-level acceptance assertion ids,
  and the parent assertions remain failing.

## Required Fixes

- Run migration apply/reapply with an authorized `DATABASE_URL` under the
  supported Node version and record the exact result.
- Stabilize the implementation revision, obtain verification-owned runtime
  status, and generate task acceptance evidence without inventing assertion
  ids.
- Re-run the foundation contract and focused tests after the source owner
  stops changing the reviewed snapshot.
