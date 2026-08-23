# Graph Runtime Agent Instructions

This package contains framework-neutral workflow utilities.

- Keep this package independent from a concrete graph engine and business domain.
- Registry keys are immutable `<graph-key>:<graph-version>` identifiers.
- Idempotency helpers must remain deterministic across processes and Node.js restarts.
- Never persist raw credentials, signed URLs, prompts, image bytes or video bytes in graph state.
- Interrupt extraction must treat all external data as `unknown` and validate at the domain boundary.
- Add tests for idempotency, registry version selection and interrupt parsing changes.
