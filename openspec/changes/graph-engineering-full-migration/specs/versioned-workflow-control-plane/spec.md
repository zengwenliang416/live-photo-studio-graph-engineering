## ADDED Requirements

### Requirement: Immutable workflow graph binding

Every workflow run MUST persist one published `graphKey` and `graphVersion`
at creation time and MUST use `workflowRunId` as the LangGraph `thread_id`.

#### Scenario: Start binds a published graph

- **WHEN** an authorized client starts a workflow
- **THEN** the API creates one run with the requested published graph binding
  and rejects an unpublished or unsupported binding

#### Scenario: Restart resolves the same graph version

- **WHEN** an orchestrator process restarts while a run is interrupted
- **THEN** the run resumes through the graph factory recorded on that run and
  does not switch to the newest graph version

### Requirement: Single routing owner

The orchestrator MUST be the only component that chooses the next Graph phase
or writes Graph-path phase transitions. API and workers MUST publish commands
or facts instead.

#### Scenario: Worker completion resumes the graph

- **WHEN** an AI or media worker commits a fact and emits a valid signal
- **THEN** the orchestrator validates the signal and performs the phase
  transition

#### Scenario: Worker cannot route a phase

- **WHEN** a worker processes a generation or render job
- **THEN** it writes domain facts and a signal without writing
  `workflow_runs.current_phase`

### Requirement: Bounded human repair loop

The graph MUST cap regeneration attempts and MUST route an exhausted repair
loop to a human fallback or terminal failure.

#### Scenario: Regeneration stays within the budget

- **WHEN** a human task requests REGENERATE below `maxRepairAttempts`
- **THEN** exactly one new revision and generation dispatch are created

#### Scenario: Regeneration budget is exhausted

- **WHEN** a human task requests REGENERATE at the configured limit
- **THEN** the graph rejects another generation and enters the documented
  failure or human fallback state

### Requirement: Terminal late-signal handling

The graph MUST consume a valid late signal for a terminal run without reopening
the run or creating a new business effect.

#### Scenario: Cancellation precedes completion

- **WHEN** a run reaches CANCELLED before a generation or render completion
  signal arrives
- **THEN** the signal is recorded as consumed or not applicable and the run
  remains CANCELLED
