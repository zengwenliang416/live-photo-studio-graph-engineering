# Development Migrations: graph-engineering-full-migration

## Execution Order

The manifest contains one development-only evidence table migration. It is
separate from `packages/database/migrations` and must never be substituted for
the product migration runner.

## Validation

Run the exact commands in `manifest.json` with a development database. The
first command must succeed with `ON_ERROR_STOP=1`; the rollback must remove only
the evidence table and must also succeed with `ON_ERROR_STOP=1`.

## Rollback

Rollback is limited to the development evidence table. Product workflow tables,
checkpoints, outbox rows and active runs are not touched.
