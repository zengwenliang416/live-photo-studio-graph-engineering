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

## Protected Canary Criteria

- A `main` push is accepted only by the repository-scoped trusted Woodpecker
  agent. The pipeline builds a Node 24 image tagged from the commit SHA, runs
  application migrations and LangGraph checkpoint setup, replaces the API,
  Web, Orchestrator and both Workers, then records the current and previous
  image tags.
- PostgreSQL and Redis use dedicated persistent volumes. Application rollback
  switches only the five application services to the previous image and does
  not delete database, checkpoint, Outbox, Redis or object-storage data.
- `livephoto.motion-cover.com` is proxied through Cloudflare to Nginx. An
  unauthenticated request returns `401`; an authenticated request reaches the
  Web and same-origin `/v1` API. Web/API container ports remain loopback-only.
- Shared RustFS CORS adds only `https://livephoto.motion-cover.com`; credentials,
  signed URLs and encryption keys remain server-side and absent from repository
  files, CI logs and browser bundles.
- The deployed service is visibly and operationally a protected canary using
  `AI_PROVIDER=mock`. It must not claim public-production readiness, real model
  output, PhotoKit persistence or a Photos-library Live Photo.

## Verification Surfaces

- Facticity: inspect the current repository, migrations, contracts and runbook
  against the ExecPlan and record command output.
- Static: `pnpm check`, Graph dependency checks, forbidden-import checks and
  SpecNav stage contracts.
- Unit: package tests plus Graph, Outbox, API, web and worker tests.
- Redteam: cross-project access, malformed signal, replayed command, log/state
  leakage and retry multiplication tests.
- E2E: PostgreSQL restart/duplicate-signal suites, the protected public
  hostname, authenticated same-origin API, RustFS CORS and rollback exercise.
- Sensory: authenticated mobile workflow review at 390px, explicit export
  boundary copy and visible protected-canary positioning.

## Unresolved Gaps

- Live Redis authentication is an environment dependency; the repository must
  retain a precise operator command and must not claim that the live Redis
  smoke passed when it cannot run.
