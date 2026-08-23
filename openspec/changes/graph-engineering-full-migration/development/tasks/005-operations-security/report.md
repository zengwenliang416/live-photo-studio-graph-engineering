# Task Report: 005-operations-security

## Status

DONE_WITH_CONCERNS

## Files Changed

- Reviewed current trace/canary changes in API/config and workflow persistence,
  shared workflow observability schemas and redaction tests, Graph effect
  metadata, and worker/API context propagation.

## What Changed

- Workflow starts accept or generate a trace id; graph commands/signals carry
  bounded execution metadata such as trace, node, external-job, and provider
  request identifiers.
- Shared redaction logic covers credentials, signed URLs, prompts, provider
  responses, binary values, and EXIF/GPS-like keys in the current contract
  tests.
- Canary user configuration and an admin user configuration field are present
  in the API config surface.

## TDD Evidence

- The current shared observability tests cover metadata parsing and sensitive
  value redaction.
- API, orchestrator, and worker focused tests passed at the observed command
  times; PostgreSQL worker/orchestrator suites also passed.
- No complete authenticated triage, metrics, or red-team suite was executed.

## Verification Commands

- `pnpm check`
- `pnpm test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/orchestrator test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-ai test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-media test`
- `git diff --check`

## Concerns

- Metrics and an authenticated read-only triage projection are not evidenced.
- The admin configuration field is not sufficient evidence of an implemented
  operator repair/replay boundary or audit trail.
- Cross-project, malformed-signal, signed-URL, Base64, prompt, EXIF, and
  credential checks are only partially covered by the current local tests.
- No signed verification receipt is available.

## Scope Deviations

- No observability, security, source, infrastructure, or runbook file was
  edited by this handoff cleanup.

## Follow-up Needed

- Add and verify the operational projection, metrics, audit boundary, and
  complete red-team cases before claiming the task complete.

## Adjudication

The current metadata and redaction work is useful partial evidence, but the
task remains needs-fix because its operational and red-team acceptance is not
complete.

## Stable Snapshot Revalidation (2026-08-23)

The complete API suite passed 30/30 and the PostgreSQL-backed operations suite
passed within the API total of 33/33. Graph contracts passed 6/6, including
malformed-signal and sensitive-field redaction matrices. The repair also
preserves project ownership, fail-closed signed-download behavior and task
action authorization.

The report remains `DONE_WITH_CONCERNS`: private bucket/signed-URL TTL,
credentialed Redis/BullMQ, real provider cost behavior and production media
checks are unavailable. Parent A3 remains `failing`.
