import assert from "node:assert/strict";
import test from "node:test";
import { ApiProblemError, type WorkflowApiClient } from "./api-client.js";
import {
  resolveWorkflowRunId,
  workflowRunStorageKey,
  type WorkflowSessionStorage,
} from "./workflow-session.js";

const STORED_RUN_ID = "00000000-0000-4000-8000-000000000001";
const STARTED_RUN_ID = "00000000-0000-4000-8000-000000000002";
type WorkflowRunResponse = {
  data: {
    projectId: string;
    status: string;
    currentPhase: string | null;
    pendingHumanTaskId: string | null;
  };
};

class MemoryStorage implements WorkflowSessionStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function fakeClient(input: {
  readonly getWorkflowRun?: (
    workflowRunId: string,
  ) => Promise<WorkflowRunResponse>;
  readonly startWorkflowRun?: () => Promise<{
    data: { workflowRunId: string };
  }>;
}): Pick<WorkflowApiClient, "getWorkflowRun" | "startWorkflowRun"> {
  return {
    getWorkflowRun:
      input.getWorkflowRun ??
      (async (_workflowRunId: string) => ({
        data: {
          projectId: "project-1",
          status: "RUNNING",
          currentPhase: "WAITING_GENERATION",
          pendingHumanTaskId: null,
        },
      })),
    startWorkflowRun:
      input.startWorkflowRun ??
      (async () => ({ data: { workflowRunId: STARTED_RUN_ID } })),
  };
}

test("refresh/reopen revalidates and returns the stored workflow run", async () => {
  const storage = new MemoryStorage();
  storage.setItem(workflowRunStorageKey("project-1"), STORED_RUN_ID);
  let starts = 0;
  const runId = await resolveWorkflowRunId(
    fakeClient({
      startWorkflowRun: async () => {
        starts += 1;
        return { data: { workflowRunId: STARTED_RUN_ID } };
      },
    }),
    "project-1",
    storage,
  );

  assert.equal(runId, STORED_RUN_ID);
  assert.equal(starts, 0);
});

test("a confirmed missing run is replaced and persisted", async () => {
  const storage = new MemoryStorage();
  storage.setItem(workflowRunStorageKey("project-2"), STORED_RUN_ID);
  const runId = await resolveWorkflowRunId(
    fakeClient({
      getWorkflowRun: async () => {
        throw new ApiProblemError(404, "WORKFLOW_RUN_NOT_FOUND", "missing");
      },
    }),
    "project-2",
    storage,
  );

  assert.equal(runId, STARTED_RUN_ID);
  assert.equal(storage.getItem(workflowRunStorageKey("project-2")), STARTED_RUN_ID);
});

test("a stored run from another project is not reused", async () => {
  const storage = new MemoryStorage();
  storage.setItem(workflowRunStorageKey("project-5"), STORED_RUN_ID);
  let starts = 0;
  const runId = await resolveWorkflowRunId(
    fakeClient({
      getWorkflowRun: async () => ({
        data: {
          projectId: "project-other",
          status: "RUNNING",
          currentPhase: "WAITING_GENERATION",
          pendingHumanTaskId: null,
        },
      }),
      startWorkflowRun: async () => {
        starts += 1;
        return { data: { workflowRunId: STARTED_RUN_ID } };
      },
    }),
    "project-5",
    storage,
  );

  assert.equal(runId, STARTED_RUN_ID);
  assert.equal(starts, 1);
  assert.equal(storage.getItem(workflowRunStorageKey("project-5")), STARTED_RUN_ID);
});

test("concurrent mounts share one start request", async () => {
  const storage = new MemoryStorage();
  let starts = 0;
  let releaseStart: (() => void) | undefined;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const client = fakeClient({
    startWorkflowRun: async () => {
      starts += 1;
      await startGate;
      return { data: { workflowRunId: STARTED_RUN_ID } };
    },
  });

  const first = resolveWorkflowRunId(client, "project-3", storage);
  const second = resolveWorkflowRunId(client, "project-3", storage);
  releaseStart?.();

  assert.deepEqual(await Promise.all([first, second]), [
    STARTED_RUN_ID,
    STARTED_RUN_ID,
  ]);
  assert.equal(starts, 1);
});

test("non-404 reopen errors are not hidden by starting another run", async () => {
  const storage = new MemoryStorage();
  storage.setItem(workflowRunStorageKey("project-4"), STORED_RUN_ID);
  let starts = 0;
  const failure = new ApiProblemError(503, "SERVICE_UNAVAILABLE", "retry later");
  await assert.rejects(
    resolveWorkflowRunId(
      fakeClient({
        getWorkflowRun: async () => {
          throw failure;
        },
        startWorkflowRun: async () => {
          starts += 1;
          return { data: { workflowRunId: STARTED_RUN_ID } };
        },
      }),
      "project-4",
      storage,
    ),
    (error: unknown) => error === failure,
  );
  assert.equal(starts, 0);
});
