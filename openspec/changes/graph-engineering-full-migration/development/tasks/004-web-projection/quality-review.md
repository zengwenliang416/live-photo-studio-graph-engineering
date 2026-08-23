# Quality Review: 004-web-projection

## Verdict

needs-fix

## Separation Of Concerns

- The reported page, query hooks, centralized API client, and SSE invalidation
  boundaries follow the requested web architecture. The missing export copy is
  a product-surface gap rather than a reason to mix data fetching into
  presentational controls.

## Component Cohesion / Coupling

- Route identity, query projection, task payload, and idempotency concerns are
  described as separate seams. The concurrent API/web changes prevent a
  complete coupling review and no shared export-boundary component is
  evidenced.

## Test Quality

- Web and API unit suites passed at the observed command time, but they do not
  establish 390px accessibility, refresh/reopen, or duplicate-click behavior.
  No system-executed receipt is available.

## Error Handling

- Stable error text, cancel/error states, and task action gating are reported.
  Browser-level recovery and access-denial presentation remain unverified.

## Reuse / Duplication

- The existing API client, query hooks, and SSE invalidation hook are reused.
  No concrete duplicated component was identified from the available evidence.

## Complexity Delta

- Persisted route/query state and task-gated actions add modest client
  coordination complexity while reducing client-held workflow truth. The lack
  of browser evidence leaves the user-facing failure modes unmeasured.

## Required Fixes

- Add and test the export boundary copy and mobile accessibility behavior.
- Run refresh/reopen and duplicate-submit checks against a stable revision.
- Attach verification-owned evidence before changing the verdict.

## Stable Snapshot Revalidation (2026-08-23)

Web/API unit and integration suites pass with complete test discovery. The
server projection remains authoritative, stored runs are checked against the
current project, and review/cancel actions are gated by the current task
payload.

**Verdict remains `needs-fix`** because browser sensory evidence and real
private-storage download verification are unavailable.
