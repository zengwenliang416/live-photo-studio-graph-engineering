# Development Basis: graph-engineering-full-migration

## Requirements Reference

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/spec-map.json`
- `openspec/changes/graph-engineering-full-migration/component-impact-map.json`

## Foundation Specifications

- `openspec/specs/ui-design/design.md`
- `openspec/specs/system-architecture/design.md`
- `openspec/specs/frontend-backend-data-flow/design.md`
- `openspec/specs/component-architecture/design.md`

## Prototype Reference

- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`
- `openspec/changes/graph-engineering-full-migration/prototype/decision.json`
- `openspec/changes/graph-engineering-full-migration/prototype/logic/harness.js`

## Handoff Reference

Development is allowed only after the prototype handoff and decision are valid.

## Component Architecture Constraint

Implementation must preserve high cohesion and low coupling. Any duplicated UI,
state, validation, formatting, or domain behavior that meets the extraction rule
must become a shared component, hook, utility, or service.
