import { randomUUID } from "node:crypto";

const API_BASE = process.env["NEXT_PUBLIC_API_BASE"] ?? "http://localhost:4000";

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
const defaultKeyStore = {
  get: (actionId: string): string | undefined => memoryKeys.get(actionId),
  set: (actionId: string, key: string): void => {
    memoryKeys.set(actionId, key);
  },
};

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
        key = randomUUID();
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
    return (await response.json()) as T;
  }

  startWorkflowRun(projectId: string): Promise<{ data: { workflowRunId: string } }> {
    return this.request(
      "POST",
      `/v1/projects/${projectId}/workflow-runs`,
      {},
      `start:${projectId}`,
    );
  }

  getWorkflowRun(workflowRunId: string): Promise<{ data: { status: string; currentPhase: string | null; pendingHumanTaskId: string | null } }> {
    return this.request("GET", `/v1/workflow-runs/${workflowRunId}`);
  }

  listHumanTasks(workflowRunId: string): Promise<{
    data: ReadonlyArray<{
      humanTaskId: string;
      allowedActions: readonly string[];
      status: string;
    }>;
  }> {
    return this.request("GET", `/v1/workflow-runs/${workflowRunId}/human-tasks`);
  }

  decide(humanTaskId: string, body: { action: string; selectedOutputId?: string }): Promise<{ data: { humanTaskId: string } }> {
    return this.request(
      "POST",
      `/v1/human-tasks/${humanTaskId}/decisions`,
      body,
      `decide:${humanTaskId}:${body.action}`,
    );
  }

  cancel(workflowRunId: string): Promise<{ data: { workflowRunId: string } }> {
    return this.request(
      "POST",
      `/v1/workflow-runs/${workflowRunId}/cancel`,
      { reason: "USER_REQUESTED" },
      `cancel:${workflowRunId}`,
    );
  }

  eventsUrl(workflowRunId: string): string {
    return `${this.base}/v1/workflow-runs/${workflowRunId}/events`;
  }
}
