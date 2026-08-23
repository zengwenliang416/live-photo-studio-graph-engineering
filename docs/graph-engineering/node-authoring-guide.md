# Node Authoring Guide

Every node must have a `GraphNodeDefinition` and a stable versioned name.

## Pure node

A pure node reads state and returns a partial state update. It has no network,
database, queue, clock or random dependency.

## Side-effect node

A side-effect node must:

1. Build a deterministic effect key from workflow ID, node name, node version,
   business revision and normalized business input.
2. Use an `ensure*` application service whose write and Outbox record share a
   database transaction.
3. Return only IDs and small state values.
4. Be safe when the node is re-executed after an interrupt or process crash.

## Interrupt node

The payload must include a stable node name, workflow run ID and either a human
task type or expected external signal types. Resume data is always parsed with a
schema and checked against the expected correlation ID.

## Router

Routing is deterministic code. A model may return a structured recommendation,
but it may not return an arbitrary node name or bypass authorization, billing,
moderation or required human review.

## Compatibility

Published nodes and state fields are compatibility surfaces. For breaking
changes create a new graph version. Keep the old factory registered until no
active run references it.
