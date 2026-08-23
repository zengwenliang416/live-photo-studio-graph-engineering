# Quality Review: 002-durable-orchestration

## Verdict

needs-fix

## Separation Of Concerns

- The reported split between API Outbox publication, repository signal state,
  and orchestrator Graph transitions matches the architecture. The failed demo
  indicates the human-review input seam is not yet operationally coherent.

## Component Cohesion / Coupling

- Reuse of `GraphEngine`, repository signal state, and existing node definitions
  is appropriate. Correlation and resume handling span several modules, so the
  missing `correlationId` demo field is a concrete coupling defect to resolve.

## Test Quality

- The 11-test PostgreSQL suite is strong local evidence for the listed
  scenarios, but the demo failure and unchecked task items show incomplete
  coverage of the user-visible path. No system-executed receipt is available.

## Error Handling

- Wrong-correlation, late-signal, stale-recovery, and malformed Outbox cases
  are reported as covered. The resume payload failure demonstrates that input
  validation still rejects a required path before successful recovery can be
  observed.

## Reuse / Duplication

- No new duplicate transition abstraction was identified. Existing effect keys,
  locks, and graph nodes are reported as reused.

## Complexity Delta

- Locking, visibility timeouts, correlation, cancellation, and bounded repair
  add state-machine complexity. The current tests reduce risk, but the failed
  demo leaves the cross-boundary complexity insufficiently validated.

## Required Fixes

- Fix and rerun the demo human-review resume path.
- Record system-executed evidence for the full orchestration matrix after the
  implementation snapshot is stable.
- Do not close the task while 2.3-2.5 remain unchecked or A1 remains failing.
