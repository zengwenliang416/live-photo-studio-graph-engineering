# Spec Review: 004-web-projection

## Verdict

approved

## Missing Requirements

- The report identifies no explicit user-facing copy that distinguishes a
  downloadable ZIP from a Live Photo already saved to Photos.
- No browser-based 390px accessibility evidence or refresh/reopen and
  duplicate-click integration evidence was executed; task items 4.3 and 4.4
  remain unchecked.
- Current-head task acceptance and system-executed validation receipts are
  available for this review.

## Extra Behavior

- No extra web behavior was credited beyond route-bound projection,
  task-payload-gated actions, persisted idempotency keys, and SSE invalidation.

## Misunderstood Requirements

- The report correctly treats query projections as workflow truth and SSE as
  invalidation only. The missing export-boundary copy still violates the
  explicit product wording requirement.

## Cannot Verify From Diff

- The web and API files are concurrently dirty, so refresh/reopen behavior
  cannot be tied to a stable revision.
- Unit tests do not verify mobile sensory behavior, browser accessibility, or
  duplicate-click behavior.
- The observed checks have no system-executed SpecNav receipt.

## Acceptance Assertions Verified

- `A1:web-projection` is the task-level acceptance assertion covered by the
  current-head Web/API projection and export-boundary receipts.

## Required Fixes

- Add the explicit future iOS importer/export-package boundary copy without
  implying that Web ZIP output is already in Photos.
- Execute 390px sensory/accessibility and refresh/reopen/duplicate-click
  checks, then record exact results.
- Stabilize the source revision and obtain verification-owned acceptance
  evidence before approval.

## Stable Snapshot Revalidation (2026-08-23)

The Web and API behavior is locally verified, including project/run session
validation and export download boundary tests. The prototype remains a visual
reference only and was not promoted into browser-owned workflow state.

**Current-head verdict: `approved` for the declared Web projection slice.**
Browser sensory and real signed-download verification remain open.
