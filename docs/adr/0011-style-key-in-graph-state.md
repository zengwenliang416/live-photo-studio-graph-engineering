# ADR 0011: Carry the Style Key in Graph State

- Status: Accepted
- Date: 2026-08-25

## Context

A workflow run needs the style preset chosen at start time so the generation
worker can compile prompts. The style could be re-read from the project table
at generation time, but project rows are mutable while a run is paused at
human review.

## Decision

Pass `styleKey` as an additive optional field from the `START_WORKFLOW`
command input into the v1 graph state, and from `dispatch_generation_v1` into
the `workflow.generation.requested.v1` payload. The node also includes
`styleKey` (null when absent) in its effect key business input, so runs with
different styles produce different idempotency keys while same-style replays
reuse the recorded effect.

## Consequences

Positive:

- The run is bound to its style at creation, so checkpoint resume and replay
  regenerate with the style the user actually chose.
- The effect key naturally distinguishes styles; no worker-side lookup can
  diverge from the dispatched payload.
- Old payloads and checkpoints without `styleKey` remain valid.

Costs:

- Changing the style requires a new workflow run; there is no in-run style
  mutation path yet.
- Every payload consumer must tolerate the optional field.

## Rejected alternatives

- Worker reads the project row at generation time: the value can change while
  the run is paused, breaking replay determinism and effect-key stability.
- A new graph version: unnecessary, because the change is additive optional
  and old runs parse unchanged.
