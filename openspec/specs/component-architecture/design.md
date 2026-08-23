# Component Architecture & Reuse Spec

## Overview

The product separates workflow projection, domain action selection, and visual
rendering. Shared controls remain presentation-only; API clients and query
hooks remain data-boundary code; Graph and worker implementations stay outside
the web component tree.

## Component Taxonomy

- Page/screen components: project workflow page and review/export screens.
- Layout components: page shell, workflow stage layout and responsive action
  region.
- Domain components: candidate review, task action group, workflow stage
  summary and export notice.
- Form components: labeled action controls and selected-output input boundary.
- Data display components: candidate preview grid, metadata table and status
  timeline.
- Feedback components: loading stage, permission error, retryable error,
  stale-task conflict and cancel confirmation.
- Headless hooks: workflow projection, human-task query, SSE invalidation and
  idempotent mutation hooks.
- Domain utilities/services: action eligibility and stage derivation from
  typed API projections; no database access.

## Cohesion Rules

- A component should have one clear reason to change.
- UI-only rendering, domain transformation, data fetching, and side effects must
  not be mixed unless this spec explicitly allows it.
- Keep component props aligned with user-visible behavior, not database internals.

## Coupling Rules

- Page components may compose shared components.
- Shared components must not import page-specific modules.
- Domain components may depend on domain types, but not on routing globals unless
  declared here.
- Infrastructure, API clients, and database code must not leak into presentational
  components.

## Shared Component Extraction Rules

Extract a component, hook, utility, or service when any of these are true:

- The same UI behavior appears in two or more screens.
- The same state machine is repeated.
- The same validation or formatting rule is repeated.
- A page-local component exceeds a single user-facing responsibility.
- A proposed implementation would duplicate a design-system control.

## Component Public API Rules

- Props must be stable, minimal, and behavior-facing.
- Do not expose raw database entities unless the component is explicitly a data
  boundary component.
- Events should name domain/user intent, not DOM implementation details.
- Slots/children are allowed only when they reduce coupling.

## State Ownership Rules

- Local state: transient selection, disclosure and submit/loading state.
- Shared UI state: only cross-page UI preferences if introduced later; no
  workflow truth.
- Server/cache state: TanStack Query workflow and task projections.
- Form state: local component state or a form library at the page boundary.
- URL state: project and workflow identifiers.
- Derived state: permitted task actions and visible stage from typed projection.

## Composition Patterns

- Preferred composition patterns: page composes domain components; domain
  components receive behavior-facing typed props; hooks provide query data and
  mutation callbacks.
- Forbidden composition patterns: presentational components issuing fetches,
  importing database rows, reading auth globals, or writing workflow phases.
- Approved provider/context boundaries: Query client and accessibility
  providers at the application root; no binary media in context.
- Approved headless hook patterns: one query hook per server projection and one
  mutation hook per command with stable idempotency behavior.

## File & Naming Conventions

- Component file naming: `kebab-case.tsx`; named exports by default.
- Hook naming: `use-kebab-case.ts` with typed API boundaries.
- Test naming: adjacent `*.test.ts` or `*.test.tsx`.
- Story/prototype naming: keep prototypes under the designated artifact
  directory and do not import them into production pages.
- Barrel/export rules: export public package APIs explicitly; avoid broad
  barrels that create circular dependencies.

## Testing Expectations

- Shared component tests: action visibility, disabled state, focus and
  accessible labels.
- Hook tests: request schema, idempotency key reuse and query invalidation.
- Integration tests: project refresh, task decision, cancellation and stale
  conflict against the API contract.
- Accessibility checks: keyboard focus, form labels, button names and error
  text.
- Visual/prototype review: mobile width at 390px, candidate recognition and
  direct comparison tables for operational views.

## Refactor Triggers

- Duplicate logic detected:
- Cross-boundary import detected:
- Props become data-source-specific:
- Component grows multiple responsibilities:
- Test setup requires unrelated modules:

## Component Do's and Don'ts

- Do extract reusable UI, hooks, and domain utilities when the extraction rules trigger.
- Do keep shared components independent of page-specific state and routes.
- Do update this spec before adding a new shared component family.
- Don't copy/paste component logic across pages.
- Don't make low-level components know about API clients, database rows, or auth globals.
