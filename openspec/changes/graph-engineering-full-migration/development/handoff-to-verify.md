# Development Handoff To Verify: graph-engineering-full-migration

## Implemented Slices

- The Graph foundation retains immutable `graphKey + graphVersion` binding,
  `workflowRunId` thread identity, typed command/signal/job payloads, and the
  API transactional Outbox boundary.
- Durable orchestration has current unit and PostgreSQL-backed coverage for
  restart recovery, duplicate START and completion delivery, stale signal
  recovery, wrong correlation, late cancellation signals, bounded
  REGENERATE, and old graph-version resolution.
- AI and media workers use deterministic batch/output/package identities,
  perform provider or renderer work outside the database transaction, validate
  project/run ownership, and emit correlated completion or failure signals.
- The web projection reads the project identity from the route, persists the
  workflow run id in browser storage, uses query data as the workflow truth,
  uses SSE only for invalidation, and gates review actions by the current task
  payload.
- Trace metadata, canary user configuration, workflow observability schemas,
  and sensitive-value redaction are present in the current dirty worktree.
  Metrics, authenticated read-only triage, and complete red-team coverage are
  not evidenced.

## Files Changed

- The following implementation paths are dirty in the shared worktree and were
  inspected but not modified by this handoff cleanup:
  - API: `apps/api/src/config.ts`, `apps/api/src/openapi.ts`,
    `apps/api/src/testing/in-memory-workflow-unit.ts`,
    `apps/api/src/workflows/application/workflow-service.ts`,
    `apps/api/src/workflows/infrastructure/outbox-dispatcher.ts`,
    `apps/api/src/workflows/infrastructure/outbox-dispatcher.test.ts`,
    `apps/api/src/workflows/infrastructure/pg-workflow-unit.ts`,
    `apps/api/src/workflows/ports.ts`, and
    `apps/api/src/workflows/workflows.controller.ts`.
  - Orchestrator: `apps/orchestrator/src/application/graph-engine.ts`,
    `apps/orchestrator/src/graph-engine.integration.test.ts`,
    `apps/orchestrator/src/graphs/live-photo-project/`, and
    `apps/orchestrator/src/infrastructure/workflow-repository.ts`.
  - Web: `apps/web/src/app/projects/[projectId]/page.tsx`,
    `apps/web/src/hooks/use-workflow.ts`,
    `apps/web/src/hooks/use-workflow-events.ts`,
    `apps/web/src/lib/api-client.ts`, and
    `apps/web/src/lib/api-client.test.ts`.
  - Workers: `apps/worker-ai/src/` and `apps/worker-media/src/` changed
    services, adapters, entrypoints, and integration tests.
  - Shared contracts/runtime: `packages/graph-contracts/src/`,
    `packages/graph-runtime/src/idempotency.ts`,
    `packages/graph-runtime/src/idempotency.test.ts`, and the current
    `packages/database/migrations/0005_workflow_operations.sql`.

## Requirements Covered

- Partially evidenced: immutable graph binding, transactional command
  publication, correlated signals, deterministic worker effects, projection
  refresh state, task-payload action gating, trace identifiers, canary
  configuration, mock-provider defaults, and redaction behavior.
- Not accepted: parent assertions A1, A2, and A3 remain `failing` in
  `acceptance.json`.
- Not accepted: the web page still lacks explicit copy stating that the ZIP is
  a downloadable package for a future iOS importer rather than an asset saved
  to Photos.
- Not accepted: the six task checklists still contain incomplete items,
  including web export accessibility, operations triage, and canary evidence.

## Prototype Decisions Implemented

- The approved `logic-state` variant is represented by the current start,
  generation, human review, render, export, cancel, and refresh/recovery flow.
- The selected-output decision now carries a task-declared output id and
  human-task correlation id.
- The prototype's future iOS import boundary remains an acceptance item; no
  Web ZIP result is represented as an already-saved Photos asset.

## Components Created / Reused / Extracted

- Reused the centralized typed API client, TanStack Query workflow/task
  projection, SSE invalidation hook, Graph engine/repository ports, worker
  provider/renderer ports, and deterministic effect-key utilities.
- Added deterministic UUID helpers and shared workflow execution metadata with
  sensitive-value redaction in the current implementation.
- Added candidate output projection and task-payload action gating to the
  existing web flow.
- No separate shared web export-boundary component or operator triage
  projection is evidenced.

## API / Data Flow Changes

- API start, decision, and cancel writes remain idempotent and publish through
  the transactional Outbox; malformed routed payloads are rejected and
  event-only workflow completion records are marked sent without queueing.
- Worker jobs carry ids, versions, and bounded configuration; workers write
  domain facts before emitting correlated Graph signals and do not choose Graph
  phases.
- Workflow starts now carry trace metadata, published graph validation, and
  canary cohort checks. The current source also carries redaction metadata for
  command and signal context.
- Web state is recovered from route/local storage plus API projection; SSE
  invalidates queries and does not carry final workflow state.

## Tests Added

- Orchestrator tests cover restart, duplicate delivery, duplicate START,
  stale recovery, wrong correlation, late cancellation signals, bounded
  REGENERATE, and old-version resolution.
- Worker PostgreSQL tests cover deterministic completion, duplicate delivery,
  cross-project rejection, phase preservation, and failure signal idempotency.
- API and web tests cover idempotency, ownership, task-payload gating,
  malformed identifiers, event-only Outbox delivery, and selected-output
  submission.
- Contract/runtime tests cover deterministic identifiers and sensitive-value
  redaction.

## Local Validation

- Passed at the observed command times: `pnpm install --frozen-lockfile`,
  `pnpm check`, `pnpm test`, `pnpm graph:check`, `pnpm graph:test`, and
  `git diff --check`.
- Passed focused tests: graph-contracts (2 tests before the later
  observability additions), graph-runtime (3), API (19), web (4), and
  orchestrator (4 without PostgreSQL).
- Passed with `RUN_PG_TESTS=1`: orchestrator (11), worker-ai (5), and
  worker-media (6).
- Blocked: `pnpm db:migrate` built all packages but stopped because
  `DATABASE_URL` is not set.
- Failed: `pnpm graph:demo` reached human review and then raised a Zod error
  because the demo resume payload omitted required `correlationId`.
- The SpecNav handoff contract was executed and returned `ok:false`; the
  remaining contract blockers are recorded below and must not be treated as a
  successful handoff.

## Known Risks

- The shared worktree contains concurrent uncommitted implementation changes;
  task acceptance cannot be signed against a stable implementation snapshot.
- The repository requires Node `>=24`, while the observed runtime was
  Node `v22.19.0`; pnpm also reported that the `sharp` build script was
  ignored.
- The verification receipt authority cannot load
  `verify/v2/runtime-status.json`, so no system-executed SpecNav receipt is
  available.
- The six task contexts declare no task-level acceptance ids, so the official
  task acceptance generator cannot produce approved evidence.
- Live provider, production codec/HEIC, operator triage, mobile sensory, and
  real infrastructure checks remain unverified.

## Items Requiring Six-Domain Verification

- Facticity: reconcile the current dirty implementation with the change
  requirements, migrations, and graph ownership rules after the source owner
  provides a stable revision.
- Static: run graph dependency, forbidden-import, contract, and SpecNav checks
  under the declared Node version.
- Unit: rerun all package tests after the current source changes settle.
- Redteam: verify cross-project access, malformed signals, signed URL and
  prompt redaction, Base64/EXIF leakage, and retry ownership.
- E2E: rerun PostgreSQL restart/duplicate-signal coverage and the demo path
  after the missing human-task correlation is corrected.
- Sensory: inspect the workflow at 390px and add the explicit future iOS
  importer/export boundary copy.
