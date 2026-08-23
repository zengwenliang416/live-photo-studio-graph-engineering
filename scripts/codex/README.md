# Running the Graph Migration with Codex

Use a clean Git branch or worktree, commit or stash unrelated work, keep
production secrets out of the environment and leave `AI_PROVIDER=mock` for the
first pass.

```bash
git checkout -b feat/graph-engineering
corepack enable
pnpm install
./scripts/codex/run-graph-migration.sh
```

For another bounded execution after Codex stops or the context window ends:

```bash
./scripts/codex/continue-graph-migration.sh
```

The durable handoff is the repository plus the living ExecPlan, not chat history.
Review `git diff`, the updated plan and test output after every invocation.
Do not use an approval/sandbox bypass flag for this migration.
