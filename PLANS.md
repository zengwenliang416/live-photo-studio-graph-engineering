# Codex Execution Plans

For work that spans multiple modules, migrations, long-running workflows or more
than one development session, use an ExecPlan. An ExecPlan is a living,
self-contained implementation document that another coding agent can continue
without relying on chat history.

## Required behavior

- Read the root `AGENTS.md` and every nested `AGENTS.md` governing files you edit.
- Do not stop after producing a plan. Execute the current plan milestone by
  milestone unless the user explicitly requested planning only.
- Keep `Progress`, `Surprises & Discoveries`, `Decision Log` and `Outcomes &
  Retrospective` current while working.
- Record exact commands and observable results. Never claim a test passed when it
  was not run.
- Make the smallest reversible change that proves each milestone.
- Preserve a working repository between milestones.
- Treat external credentials, production infrastructure and irreversible data
  changes as blockers; implement fakes, tests and documented operator steps
  instead of fabricating success.

## Mandatory ExecPlan sections

1. Purpose and user-visible outcome
2. Progress checklist with timestamps
3. Surprises and discoveries
4. Decision log
5. Outcomes and retrospective
6. Repository context and orientation
7. Architecture invariants
8. Milestones and implementation narrative
9. Concrete commands
10. Validation and acceptance criteria
11. Idempotence, recovery and rollback
12. Interfaces and dependencies
13. Security, privacy and cost controls
14. Artifacts and operational notes

## Progress semantics

Use checkboxes, but describe partial work precisely. A milestone is complete only
when its code, tests, documentation and migration/rollback notes satisfy the
acceptance criteria. Split partially completed items into completed and remaining
parts.

## Plan changes

When implementation reveals a wrong assumption, update the plan before changing
direction. Record the reason in `Decision Log`; do not silently rewrite history.
