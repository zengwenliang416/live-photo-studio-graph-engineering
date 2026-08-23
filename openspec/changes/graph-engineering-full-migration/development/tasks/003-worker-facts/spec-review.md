# Spec Review: 003-worker-facts

## Verdict

needs-fix

## Missing Requirements

- The PostgreSQL worker suites passed 5 AI tests and 6 media tests at the
  observed command times, but task items 3.3-3.5 remain unchecked in
  `tasks.md`; the task packet and evidence are not closed consistently.
- Real provider, object-storage, production codec, and HEIC/FFmpeg capability
  checks were not exercised. The brief explicitly forbids claiming those
  external results without the required runtime.
- No task acceptance receipt or verification runtime receipt is available.

## Extra Behavior

- No extra worker ownership behavior was credited. Deterministic identities,
  fact writes, and correlated signals are evaluated only as the requested
  worker boundary.

## Misunderstood Requirements

- The report correctly states that workers do not choose Graph phases and that
  provider/renderer calls stay outside the database transaction. Passing local
  tests do not, however, prove production media/provider capability.

## Cannot Verify From Diff

- The shared worker and contract files are concurrently dirty, so ownership
  conclusions are not bound to a stable revision.
- The observed runtime is Node `v22.19.0` although the repository requires
  `>=24`; install also reported an ignored `sharp` build script.
- External provider, storage, codec, and HEIC checks have no executable
  evidence in the current handoff.

## Acceptance Assertions Verified

- None. This task context declares no task-level acceptance assertion ids, and
  parent A2 remains failing.

## Required Fixes

- Resolve or explicitly disposition the unchecked 3.3-3.5 items and rerun the
  worker integration suites on a stable source revision.
- Run the authorized external provider/storage/codec checks in a supported
  environment, recording unavailable checks as blocked rather than passed.
- Obtain verification-owned runtime and task acceptance evidence before
  changing the verdict.
