# Acceptance Criteria: graph-engineering-full-migration

## User-Visible Criteria

- A user can refresh or leave the project page and return to the current
  generation, review, render or terminal stage from the API projection.
- Review actions expose only the actions present in the current human-task
  payload; SELECT, bounded REGENERATE and CANCEL produce the documented result.
- The web export is clearly described as a downloadable package for a future
  iOS importer, not as an asset already saved to Photos. (E2E, sensory)

## System Criteria

- Every workflow run is permanently bound to one published graph key/version,
  and the orchestrator is the only Graph-path phase router. (Static, unit)
- A worker restart, orchestrator restart, duplicate signal, duplicate command,
  stale signal recovery and resume crash produce at most one business effect.
  (Unit, E2E)
- The same transient failure is retried by only one layer; repair loops are
  bounded and route to a human or terminal failure. (Unit, static)
- API, worker, web and orchestrator contracts are validated without importing
  LangGraph outside the orchestrator. (Static, unit)
- Trace and metric fields include the run/project/node/external-job context
  without secrets, Base64, signed URLs, full prompts or raw provider responses.
  (Redteam, unit)

## Data Criteria

- Additive migrations apply and reapply safely. Domain tables store IDs,
  hashes, manifests and object keys, not binary media.
- Outbox publication uses event IDs as BullMQ job IDs and malformed payloads
  become explicit invalid events rather than being silently dropped.
- Generation/render/cancellation and credit settlement paths are protected by
  deterministic effect keys or database uniqueness constraints. (Unit, E2E)

## Component Criteria

- Reusable components, hooks, utilities, or services named in
  `component-impact-map.json` are extracted instead of duplicated.

## Verification Surfaces

- Facticity: inspect the current repository, migrations, contracts and runbook
  against the ExecPlan and record command output.
- Static: `pnpm check`, Graph dependency checks, forbidden-import checks and
  SpecNav stage contracts.
- Unit: package tests plus Graph, Outbox, API, web and worker tests.
- Redteam: cross-project access, malformed signal, replayed command, log/state
  leakage and retry multiplication tests.
- E2E: PostgreSQL restart/duplicate-signal suites and operator-gated Redis
  smoke where credentials are available.
- Sensory: mobile workflow review at 390px and explicit export boundary copy.

## Unresolved Gaps

- Live Redis authentication is an environment dependency; the repository must
  retain a precise operator command and must not claim that the live Redis
  smoke passed when it cannot run.
