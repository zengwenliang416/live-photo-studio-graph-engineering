# Codex mission: execute the complete Graph Engineering migration

Work from the repository root. You are the primary implementation agent for this
repository, not a planning-only reviewer.

First read, in this order:

1. `AGENTS.md`
2. every nested `AGENTS.md` governing files you will edit
3. `PLANS.md`
4. `docs/execplans/graph-engineering-full-migration.md`
5. `docs/graph-engineering/README.md`
6. the current `README.md`, architecture ADRs and delivery notes

Then execute the living ExecPlan from its first incomplete milestone through the
final acceptance criteria.

Operating rules:

- Do not stop after summarizing or proposing changes. Inspect the repository,
  edit files, run commands, test the result and update the ExecPlan as you work.
- Preserve the existing Next.js, NestJS, PostgreSQL, Redis/BullMQ, S3/MinIO, AI
  Worker and Media Worker architecture. LangGraph is the control plane; BullMQ
  remains the long-task execution plane.
- Do not create a second top-level orchestrator. Do not replace BullMQ with
  LangGraph scheduling. Do not let workers choose project phases.
- Make the smallest reversible end-to-end change for each milestone. Keep the
  repository usable at every checkpoint.
- Use strict TypeScript. Do not introduce `any`, disable compiler checks, delete
  tests or hide errors with broad casts. Validate external input as `unknown`.
- Keep Graph state small and serializable. Never store image/video bytes, Base64,
  clients, secrets, signed URLs, full provider responses or unredacted prompts.
- Every side-effecting node must be idempotent. Use stable effect keys,
  Transactional Outbox, unique constraints and per-run locking.
- Treat published graph names, node names, state fields and signal schemas as
  compatibility surfaces. Create a new graph version for breaking changes.
- Every loop needs a maximum attempt count and a human fallback.
- Use mock/fake providers for ordinary tests. Do not require production secrets
  or chargeable model calls to pass CI.
- Never claim a command or test passed unless you ran it and observed success.
- Do not commit, push, deploy or modify production infrastructure unless the user
  explicitly asks. Work only in the current repository/worktree.

Living-plan discipline:

- Before each milestone, update `Progress` with the exact work being started.
- Record unexpected repository facts in `Surprises & Discoveries`.
- Record every material architecture choice in `Decision Log` with a reason.
- After each milestone, record exact validation commands and results.
- If blocked by unavailable credentials, network, Docker or external services,
  finish all code, fakes, tests and documentation that do not require the
  dependency. Record the exact blocker and an operator command to complete the
  check later; continue with other unblocked work.
- When context becomes tight, leave the repository in a passing state and make
  the ExecPlan sufficiently precise for the next Codex invocation to continue.

Required first actions:

1. Run `git status --short` and inspect the repository tree.
2. Read all applicable agent instructions.
3. Establish the current install/typecheck/test baseline without changing code.
4. Reconcile package versions and create `pnpm-lock.yaml` after a successful
   install.
5. Start at the first incomplete milestone in the ExecPlan.

Completion means all milestones and acceptance criteria in the ExecPlan are
satisfied, the plan's retrospective is complete, the repository checks pass,
and remaining limitations are factual external blockers rather than unfinished
implementable work.
