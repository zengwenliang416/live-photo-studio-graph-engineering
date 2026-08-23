# Prototype Question: graph-engineering-full-migration

## Question

Can the first Graph slice deterministically accept start, correlated generation
and render signals, task-payload-gated SELECT/REGENERATE/CANCEL decisions, late
terminal signals and bounded regeneration without introducing a second router?

## Branch

`logic-state`

## Review Target

- Entry: `logic/harness.js`
- Required reviewer decision: confirm that routing is deterministic, signals
  are correlated and consumed once, repair is bounded, and terminal runs ignore
  late signals.

## Out of Scope

- Production implementation.
- Database writes.
- Deployment behavior.
