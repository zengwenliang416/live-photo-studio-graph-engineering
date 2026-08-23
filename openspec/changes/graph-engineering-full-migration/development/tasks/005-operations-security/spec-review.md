# Spec Review: 005-operations-security

## Verdict

needs-fix

## Missing Requirements

- Trace and redaction metadata are partially evidenced, but metrics and an
  authenticated read-only triage projection are not implemented or verified.
- The current admin configuration field does not demonstrate an operator
  repair/replay boundary, audit event, queue-age/interrupt-age metrics, or
  failure triage behavior.
- Cross-project, malformed-signal, signed-URL, Base64, prompt, EXIF,
  credential, retry-classification, and cost-control coverage is incomplete.
- No task acceptance receipt or verification runtime receipt is available.

## Extra Behavior

- No extra operational behavior was accepted beyond the reported trace
  metadata, canary configuration, shared redaction helper, and focused tests.

## Misunderstood Requirements

- The report correctly distinguishes a configuration field from a complete
  operator boundary. Treating the field as triage or audit capability would
  misunderstand the requirement, so it is not credited.

## Cannot Verify From Diff

- The cross-process API, orchestrator, and worker changes are concurrently
  dirty and cannot be tied to a stable revision.
- No authenticated operator flow, metrics output, or red-team system receipt
  is available.
- Current tests do not establish that secrets, signed URLs, full prompts, raw
  provider responses, Base64, or EXIF data stay out of every log/state path.

## Acceptance Assertions Verified

- None. This task context declares no task-level acceptance assertion ids, and
  parent A3 remains failing.

## Required Fixes

- Implement and verify the authenticated read-only triage projection, bounded
  metrics, repair/replay authorization, and audit event boundary.
- Complete the red-team and retry/cost-control matrix with exact evidence.
- Re-run the review on a stable revision and obtain verification-owned
  acceptance evidence before approval.
