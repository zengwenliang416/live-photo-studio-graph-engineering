# Task Report: 003-worker-facts

## Status

DONE

## Files Changed

- Reviewed the current AI worker generation service/provider/tests and media
  worker export service/renderer/tests, plus the shared job payload contracts.

## What Changed

- AI and media jobs now use deterministic output, export, and signal identities;
  provider/renderer work is outside the database transaction.
- Worker paths validate workflow/run/project scope, write facts once, preserve
  `workflow_runs.current_phase`, and emit correlated completion/failure
  signals in the current PostgreSQL integration tests.

## TDD Evidence

- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-ai test` passed 5
  tests, including duplicate delivery, cross-project rejection, phase
  preservation, and failure idempotency.
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-media test` passed 6
  tests, including deterministic export replay, cross-project rejection,
  phase preservation, and failure idempotency.
- The non-PostgreSQL worker suites also passed at the observed command time.

## Verification Commands

- `pnpm --filter @live-photo-studio/worker-ai test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-ai test`
- `pnpm --filter @live-photo-studio/worker-media test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-media test`
- `pnpm check`

## Concerns

- Real provider calls, production object storage, HEIC support, and production
  FFmpeg capability were not exercised.
- The repository declares Node `>=24`; the observed runtime was Node 22 and
  pnpm reported an ignored `sharp` build script.
- No signed task acceptance evidence is available.

## Scope Deviations

- No worker source, migration, or production infrastructure file was edited
  by this handoff cleanup.

## Follow-up Needed

- Run the required external media/provider checks in the supported runtime and
  bind the results to the task acceptance contract.

## Adjudication

The worker behavior has strong local PostgreSQL evidence but remains
needs-fix for external runtime and signed acceptance gaps.

## Stable Snapshot Revalidation (2026-08-23)

AI Worker passed 3/3 ordinary tests and 9/9 PostgreSQL tests. Media Worker
passed 4/4 ordinary tests and 13/13 PostgreSQL tests. The suites cover
deterministic mock output, concurrent pre-provider/pre-render claims,
cross-project and cross-run asset/output rejection, correlated signals,
deterministic export hashes and phase-ownership preservation.

The task report is `DONE` for its declared local worker-facts slice. Real
provider calls, FFmpeg/ImageMagick/libheif/HEIC support, stale claim lease
recovery after a process crash, supported Node 24 and device-level media
checks are not verified.
