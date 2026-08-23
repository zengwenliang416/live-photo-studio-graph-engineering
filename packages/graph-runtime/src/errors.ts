export class WorkflowInvariantError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowInvariantError";
  }
}

export class WorkflowSignalMismatchError extends WorkflowInvariantError {
  constructor(expected: string, actual: string) {
    super(
      "WORKFLOW_SIGNAL_MISMATCH",
      `Expected correlation ${expected}, received ${actual}.`,
    );
    this.name = "WorkflowSignalMismatchError";
  }
}
