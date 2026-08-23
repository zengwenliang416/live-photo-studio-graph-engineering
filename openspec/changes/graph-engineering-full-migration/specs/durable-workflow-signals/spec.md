## ADDED Requirements

### Requirement: Transactional command and signal publication

Commands and worker completion signals MUST be persisted through the
Transactional Outbox with the related business fact in one database
transaction.

#### Scenario: Queue publish fails after commit

- **WHEN** the database transaction commits but the queue is unavailable
- **THEN** a later Outbox dispatcher attempt can publish the same event using
  the event ID as the BullMQ `jobId`

#### Scenario: Malformed payload is encountered

- **WHEN** an Outbox row contains a payload that fails the shared schema
- **THEN** the dispatcher records an explicit invalid-payload failure and does
  not publish an unsafe job

### Requirement: Correlated single-consumption signals

Every resume signal MUST be schema-validated, correlated to the pending
external job or human task, consumed at most once, and processed under a
per-run single-writer lock.

#### Scenario: Duplicate completion signal

- **WHEN** the same completion signal is delivered twice
- **THEN** only the first delivery resumes the graph and the second delivery is
  a no-op with no duplicate output, billing or phase transition

#### Scenario: Wrong correlation

- **WHEN** a signal has a valid type but does not match the pending job
- **THEN** the signal is rejected with a stable non-retryable error and the
  graph is not resumed

### Requirement: Recoverable processing visibility

Processing signals MUST have a visibility timeout and MUST be eligible for
controlled stale recovery after a consumer crash.

#### Scenario: Consumer crashes before consumed marker

- **WHEN** a signal is PROCESSING and its visibility timeout expires
- **THEN** recovery re-drives it under the per-run lock and preserves
  idempotent effects

#### Scenario: Fresh signal is owned by another consumer

- **WHEN** a signal is PROCESSING but its visibility timeout has not expired
- **THEN** another consumer leaves it untouched

### Requirement: Deterministic side effects

Every side effect MUST use a deterministic effect key or a database uniqueness
constraint that survives process restart and duplicate job delivery.

#### Scenario: Duplicate generation job

- **WHEN** the same generation job is processed more than once
- **THEN** the existing batch and outputs are reused and no second batch is
  created

#### Scenario: Duplicate render job

- **WHEN** the same render job is processed more than once
- **THEN** the existing export package is reused and no second package is
  created
