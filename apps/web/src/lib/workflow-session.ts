import { ApiProblemError, type WorkflowApiClient } from "./api-client.js";

export interface WorkflowSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const workflowRunStorageKey = (projectId: string): string =>
  `workflow-run:${projectId}`;

function browserStorage(): WorkflowSessionStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiProblemError && error.status === 404;
}

const inFlightRuns = new Map<string, Promise<string>>();
const TERMINAL_WORKFLOW_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

async function resolveWithoutInFlight(
  client: Pick<WorkflowApiClient, "getWorkflowRun" | "startWorkflowRun">,
  projectId: string,
  storage: WorkflowSessionStorage | undefined,
): Promise<string> {
  const storageKey = workflowRunStorageKey(projectId);
  const storedRunId = storage?.getItem(storageKey)?.trim() ?? "";
  if (storedRunId.length > 0) {
    try {
      const storedRun = await client.getWorkflowRun(storedRunId);
      if (storedRun.data.projectId === projectId) {
        return storedRunId;
      }
      storage?.removeItem(storageKey);
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error;
      storage?.removeItem(storageKey);
    }
  }

  const started = await client.startWorkflowRun(projectId);
  const runId = started.data.workflowRunId;
  storage?.setItem(storageKey, runId);
  return runId;
}

/**
 * Reopens a persisted run when it still exists, otherwise starts one once.
 * The in-flight guard also protects React Strict Mode and duplicate mount
 * effects from issuing two start commands before the first response arrives.
 */
export function resolveWorkflowRunId(
  client: Pick<WorkflowApiClient, "getWorkflowRun" | "startWorkflowRun">,
  projectId: string,
  storage: WorkflowSessionStorage | undefined = browserStorage(),
): Promise<string> {
  const existing = inFlightRuns.get(projectId);
  if (existing) return existing;

  const promise = resolveWithoutInFlight(client, projectId, storage);
  inFlightRuns.set(projectId, promise);
  const cleanup = (): void => {
    if (inFlightRuns.get(projectId) === promise) {
      inFlightRuns.delete(projectId);
    }
  };
  void promise.then(cleanup, cleanup);
  return promise;
}

/**
 * Explicitly starts from the upload page while preserving recovery semantics:
 * active runs are reopened, but a confirmed terminal run gets a fresh
 * idempotency attempt. If the start response is lost, the terminal-run-bound
 * key makes the next click replay that same server result.
 */
export async function startOrResumeWorkflowRun(
  client: Pick<WorkflowApiClient, "getWorkflowRun" | "startWorkflowRun">,
  projectId: string,
  input?: { styleKey?: string },
  storage: WorkflowSessionStorage | undefined = browserStorage(),
): Promise<string> {
  const storageKey = workflowRunStorageKey(projectId);
  const storedRunId = storage?.getItem(storageKey)?.trim() ?? "";
  let restartAfterRunId: string | undefined;

  if (storedRunId.length > 0) {
    try {
      const storedRun = await client.getWorkflowRun(storedRunId);
      if (
        storedRun.data.projectId === projectId &&
        !TERMINAL_WORKFLOW_STATUSES.has(storedRun.data.status)
      ) {
        return storedRunId;
      }
      restartAfterRunId = storedRunId;
      storage?.removeItem(storageKey);
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error;
      restartAfterRunId = storedRunId;
      storage?.removeItem(storageKey);
    }
  }

  const started = await client.startWorkflowRun(projectId, input, {
    ...(restartAfterRunId === undefined ? {} : { restartAfterRunId }),
  });
  const runId = started.data.workflowRunId;
  storage?.setItem(storageKey, runId);
  return runId;
}
