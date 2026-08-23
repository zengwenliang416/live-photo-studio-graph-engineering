# Graph Contracts Agent Instructions

These files are cross-process contracts. Changes are compatibility-sensitive.

- Never remove or rename a published enum member or required field in-place.
- Add new optional fields first; use a new schema version for breaking changes.
- Every side-effecting node definition must declare `idempotent: true` and document its effect key.
- Validate all queue, HTTP and resume payloads with Zod before using them.
- Do not import NestJS, BullMQ, PostgreSQL, LangGraph or provider SDKs into this package.
- Keep payloads small. Store asset IDs and object keys, never image or video bytes.
- Add contract tests for every new discriminated-union branch.
