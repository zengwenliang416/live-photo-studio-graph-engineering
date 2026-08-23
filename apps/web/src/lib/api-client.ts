import { z } from "zod";

const API_BASE = process.env["NEXT_PUBLIC_API_BASE"] ?? "http://localhost:4000";

const workflowRunIdSchema = z.string().uuid();
const startWorkflowResponseSchema = z.object({
  data: z.object({ workflowRunId: workflowRunIdSchema }),
});
const workflowRunResponseSchema = z.object({
  data: z.object({
    projectId: z.string().uuid(),
    status: z.string(),
    currentPhase: z.string().nullable(),
    pendingHumanTaskId: workflowRunIdSchema.nullable(),
  }),
});
const humanTasksResponseSchema = z.object({
  data: z.array(
    z.object({
      humanTaskId: workflowRunIdSchema,
      taskType: z.string(),
      nodeName: z.string(),
      allowedActions: z.array(z.string()),
      candidateOutputIds: z.array(workflowRunIdSchema),
      status: z.string(),
    }),
  ),
});
const decisionResponseSchema = z.object({
  data: z.object({ humanTaskId: workflowRunIdSchema }),
});
const cancelResponseSchema = z.object({
  data: z.object({ workflowRunId: workflowRunIdSchema }),
});
const exportDownloadResponseSchema = z.object({
  data: z.object({
    exportPackageId: workflowRunIdSchema,
    projectId: z.string().uuid(),
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    sha256: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    bytes: z.number().int().positive(),
  }),
});

export type WorkflowAction = "SELECT" | "REGENERATE" | "CANCEL";

export class ApiProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiProblemError";
  }
}

export interface ApiClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  /** Storage for per-action idempotency keys; injectable for tests. */
  readonly keyStore?: {
    get(actionId: string): string | undefined;
    set(actionId: string, key: string): void;
  };
  readonly userId?: string;
}

const memoryKeys = new Map<string, string>();

function readStoredKey(actionId: string): string | undefined {
  if (typeof window === "undefined") return memoryKeys.get(actionId);
  try {
    return window.localStorage.getItem(`workflow-idempotency:${actionId}`) ??
      memoryKeys.get(actionId);
  } catch {
    return memoryKeys.get(actionId);
  }
}

function writeStoredKey(actionId: string, key: string): void {
  memoryKeys.set(actionId, key);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`workflow-idempotency:${actionId}`, key);
  } catch {
    // Private browsing or restricted storage still has the in-memory fallback.
  }
}

const defaultKeyStore = {
  get: readStoredKey,
  set: writeStoredKey,
};

let fallbackKeyCounter = 0;

function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    fallbackKeyCounter += 1;
    return `idempotency-${Date.now().toString(36)}-${fallbackKeyCounter.toString(36)}`;
  }
  return `idempotency-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Central workflow API client. Every write carries a stable Idempotency-Key
 * per logical action so duplicate clicks replay the first server response.
 */
export class WorkflowApiClient {
  private readonly impl: typeof fetch;
  private readonly base: string;
  private readonly keys: {
    get(actionId: string): string | undefined;
    set(actionId: string, key: string): void;
  };
  private readonly userId: string;

  constructor(options: ApiClientOptions = {}) {
    this.impl = options.fetchImpl ?? fetch;
    this.base = (options.baseUrl ?? API_BASE).replace(/\/$/u, "");
    this.keys = options.keyStore ?? defaultKeyStore;
    this.userId = options.userId ?? "demo-user";
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    actionId?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-user-id": this.userId,
    };
    if (actionId) {
      let key = this.keys.get(actionId);
      if (!key) {
        key = newIdempotencyKey();
        this.keys.set(actionId, key);
      }
      headers["idempotency-key"] = key;
    }
    const response = await this.impl(`${this.base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("problem+json")) {
      const problem = (await response.json().catch(() => ({}))) as {
        code?: string;
        title?: string;
      };
      throw new ApiProblemError(
        response.status,
        problem.code ?? `HTTP_${response.status}`,
        problem.title ?? "Request failed.",
      );
    }
    const payload: unknown = await response.json();
    return schema.parse(payload);
  }

  startWorkflowRun(projectId: string): Promise<{
    data: { workflowRunId: string };
  }> {
    return this.request(
      "POST",
      `/v1/projects/${projectId}/workflow-runs`,
      startWorkflowResponseSchema,
      {},
      `start:${projectId}`,
    );
  }

  getWorkflowRun(workflowRunId: string): Promise<{
    data: {
      projectId: string;
      status: string;
      currentPhase: string | null;
      pendingHumanTaskId: string | null;
    };
  }> {
    return this.request(
      "GET",
      `/v1/workflow-runs/${workflowRunId}`,
      workflowRunResponseSchema,
    );
  }

  listHumanTasks(workflowRunId: string): Promise<{
    data: ReadonlyArray<{
      humanTaskId: string;
      taskType: string;
      nodeName: string;
      allowedActions: readonly string[];
      candidateOutputIds: readonly string[];
      status: string;
    }>;
  }> {
    return this.request(
      "GET",
      `/v1/workflow-runs/${workflowRunId}/human-tasks`,
      humanTasksResponseSchema,
    );
  }

  decide(
    humanTaskId: string,
    body: { action: WorkflowAction; selectedOutputId?: string },
  ): Promise<{ data: { humanTaskId: string } }> {
    return this.request(
      "POST",
      `/v1/human-tasks/${humanTaskId}/decisions`,
      decisionResponseSchema,
      body,
      `decide:${humanTaskId}:${body.action}`,
    );
  }

  cancel(workflowRunId: string): Promise<{ data: { workflowRunId: string } }> {
    return this.request(
      "POST",
      `/v1/workflow-runs/${workflowRunId}/cancel`,
      cancelResponseSchema,
      { reason: "USER_REQUESTED" },
      `cancel:${workflowRunId}`,
    );
  }

  getLatestExportDownload(projectId: string): Promise<{
    data: {
      exportPackageId: string;
      projectId: string;
      downloadUrl: string;
      expiresAt: string;
      sha256: string;
      durationMs: number;
      bytes: number;
    };
  }> {
    return this.request(
      "GET",
      `/v1/projects/${projectId}/export-packages/latest/download`,
      exportDownloadResponseSchema,
    );
  }

  eventsUrl(workflowRunId: string): string {
    return `${this.base}/v1/workflow-runs/${workflowRunId}/events`;
  }
}
