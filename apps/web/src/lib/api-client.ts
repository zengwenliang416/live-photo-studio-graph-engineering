import { z } from "zod";
import {
  authSessionResponseSchema,
  logoutResponseSchema,
  type AuthSessionResponse,
  type LoginRequest,
  type RegisterRequest,
} from "@live-photo-studio/contracts";

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
const projectSummarySchema = z.object({
  projectId: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().min(1),
  coverAssetId: z.string().uuid().nullable(),
});
const createProjectResponseSchema = z.object({
  data: z.object({
    projectId: z.string().uuid(),
    title: z.string(),
    createdAt: z.string().min(1),
  }),
});
const listProjectsResponseSchema = z.object({
  data: z.object({
    items: z.array(projectSummarySchema),
    nextCursor: z.string().nullable(),
  }),
});
const projectAssetSchema = z.object({
  assetId: z.string().uuid(),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative().nullable(),
  status: z.enum(["UPLOADING", "READY", "REJECTED"]),
  createdAt: z.string().min(1),
});
const projectDetailResponseSchema = z.object({
  data: projectSummarySchema.extend({
    assets: z.array(projectAssetSchema),
  }),
});
const uploadIntentResponseSchema = z.object({
  data: z.object({
    assetId: z.string().uuid(),
    uploadUrl: z.string().url(),
    uploadHeaders: z.record(z.string()),
    expiresAt: z.string().min(1),
  }),
});
const confirmAssetResponseSchema = z.object({
  data: z.object({
    assetId: z.string().uuid(),
    status: z.literal("READY"),
  }),
});
const setCoverResponseSchema = z.object({
  data: z.object({
    projectId: z.string().uuid(),
    coverAssetId: z.string().uuid(),
  }),
});
const imageProviderSettingsResponseSchema = z.object({
  data: z.object({
    configured: z.boolean(),
    baseUrl: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    updatedAt: z.string().min(1).optional(),
    keyPreview: z.string().nullable().optional(),
  }),
});
const imageProviderSaveResponseSchema = z.object({
  data: z.object({
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    enabled: z.boolean(),
    updatedAt: z.string().min(1),
  }),
});
const imageProviderDeleteResponseSchema = z.object({
  data: z.object({ configured: z.literal(false) }),
});
const stylePresetsResponseSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        description: z.string(),
        version: z.string().min(1),
        category: z.string().min(1),
        recommendedFor: z.string().min(1),
        recommendedMotion: z.string().min(1),
        colorPalette: z.tuple([z.string(), z.string(), z.string()]),
        previewStyle: z.string().min(1),
      }),
    ),
  }),
});

export type WorkflowAction = "SELECT" | "REGENERATE" | "CANCEL";

export type ProjectAssetStatus = "UPLOADING" | "READY" | "REJECTED";

export const IMAGE_PROVIDER_PUT_ACTION_ID = "settings:image-provider:put";
export const IMAGE_PROVIDER_DELETE_ACTION_ID = "settings:image-provider:delete";

export interface StylePreset {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: string;
  readonly recommendedFor: string;
  readonly recommendedMotion: string;
  readonly colorPalette: readonly [string, string, string];
  readonly previewStyle: string;
}

export interface ProjectSummary {
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly coverAssetId: string | null;
}

export interface ProjectAsset {
  readonly assetId: string;
  readonly contentType: string;
  readonly bytes: number | null;
  readonly status: ProjectAssetStatus;
  readonly createdAt: string;
}

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
    /** Optional rotation hook used after a completed logical action. */
    remove?(actionId: string): void;
  };
}

const memoryKeys = new Map<string, string>();
let unauthorizedRedirectInFlight = false;

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

function removeStoredKey(actionId: string): void {
  memoryKeys.delete(actionId);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`workflow-idempotency:${actionId}`);
  } catch {
    // Restricted storage: the in-memory entry is already gone.
  }
}

const defaultKeyStore = {
  get: readStoredKey,
  set: writeStoredKey,
  remove: removeStoredKey,
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
    remove?(actionId: string): void;
  };
  constructor(options: ApiClientOptions = {}) {
    this.impl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.base = (options.baseUrl ?? API_BASE).replace(/\/$/u, "");
    this.keys = options.keyStore ?? defaultKeyStore;
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    actionId?: string,
    redirectOnUnauthorized = true,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
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
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("problem+json")) {
      const problem = (await response.json().catch(() => ({}))) as {
        code?: string;
        title?: string;
      };
      if (
        response.status === 401 &&
        redirectOnUnauthorized &&
        typeof window !== "undefined" &&
        window.location.pathname !== "/login" &&
        !unauthorizedRedirectInFlight
      ) {
        unauthorizedRedirectInFlight = true;
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      }
      throw new ApiProblemError(
        response.status,
        problem.code ?? `HTTP_${response.status}`,
        problem.title ?? "Request failed.",
      );
    }
    const payload: unknown = await response.json();
    return schema.parse(payload);
  }

  register(input: RegisterRequest): Promise<AuthSessionResponse> {
    return this.request(
      "POST",
      "/v1/auth/register",
      authSessionResponseSchema,
      input,
      undefined,
      false,
    );
  }

  login(input: LoginRequest): Promise<AuthSessionResponse> {
    return this.request(
      "POST",
      "/v1/auth/login",
      authSessionResponseSchema,
      input,
      undefined,
      false,
    );
  }

  getAuthSession(): Promise<AuthSessionResponse> {
    return this.request(
      "GET",
      "/v1/auth/session",
      authSessionResponseSchema,
      undefined,
      undefined,
      false,
    );
  }

  logout(): Promise<{ data: { signedOut: true } }> {
    return this.request(
      "POST",
      "/v1/auth/logout",
      logoutResponseSchema,
      undefined,
      undefined,
      false,
    );
  }

  /**
   * Starts the project workflow run. The idempotency key stays
   * `start:${projectId}` even when a styleKey is given: a project has at most
   * one in-flight run, so restarting with a different style intentionally
   * replays the first recorded run instead of opening a parallel one.
   */
  startWorkflowRun(
    projectId: string,
    input?: { styleKey?: string },
  ): Promise<{
    data: { workflowRunId: string };
  }> {
    const styleKey = input?.styleKey;
    return this.request(
      "POST",
      `/v1/projects/${projectId}/workflow-runs`,
      startWorkflowResponseSchema,
      styleKey === undefined ? {} : { input: { styleKey } },
      `start:${projectId}`,
    );
  }

  getImageProviderSettings(): Promise<
    z.infer<typeof imageProviderSettingsResponseSchema>
  > {
    return this.request(
      "GET",
      "/v1/settings/image-provider",
      imageProviderSettingsResponseSchema,
    );
  }

  /**
   * Full-replace save; the server never echoes the key back, so apiKey must
   * always carry the complete secret. The fixed actionId makes retries of the
   * same save replay the first response; after a successful save the key
   * rotates, because reusing it with a different body would 409.
   */
  async putImageProviderSettings(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled?: boolean;
  }): Promise<{
    data: { baseUrl: string; model: string; enabled: boolean; updatedAt: string };
  }> {
    const result = await this.request(
      "PUT",
      "/v1/settings/image-provider",
      imageProviderSaveResponseSchema,
      {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
      IMAGE_PROVIDER_PUT_ACTION_ID,
    );
    this.keys.remove?.(IMAGE_PROVIDER_PUT_ACTION_ID);
    return result;
  }

  /**
   * Fixed actionId like the save above; the stored key is removed after a
   * successful delete so the next delete starts a fresh idempotency record.
   */
  async deleteImageProviderSettings(): Promise<{
    data: { configured: false };
  }> {
    const result = await this.request(
      "DELETE",
      "/v1/settings/image-provider",
      imageProviderDeleteResponseSchema,
      undefined,
      IMAGE_PROVIDER_DELETE_ACTION_ID,
    );
    this.keys.remove?.(IMAGE_PROVIDER_DELETE_ACTION_ID);
    return result;
  }

  listStylePresets(): Promise<{ data: { items: StylePreset[] } }> {
    return this.request("GET", "/v1/style-presets", stylePresetsResponseSchema);
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

  createProject(
    title: string | undefined,
    actionId: string,
  ): Promise<{
    data: { projectId: string; title: string; createdAt: string };
  }> {
    return this.request(
      "POST",
      "/v1/projects",
      createProjectResponseSchema,
      { title },
      actionId,
    );
  }

  listProjects(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{
    data: { items: ProjectSummary[]; nextCursor: string | null };
  }> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined && options.cursor.length > 0) {
      params.set("cursor", options.cursor);
    }
    const query = params.toString();
    return this.request(
      "GET",
      `/v1/projects${query.length > 0 ? `?${query}` : ""}`,
      listProjectsResponseSchema,
    );
  }

  getProject(projectId: string): Promise<{
    data: ProjectSummary & { assets: ProjectAsset[] };
  }> {
    return this.request(
      "GET",
      `/v1/projects/${projectId}`,
      projectDetailResponseSchema,
    );
  }

  createUploadIntent(
    projectId: string,
    input: { contentType: string; bytes: number; fileName: string },
  ): Promise<{
    data: {
      assetId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
      expiresAt: string;
    };
  }> {
    return this.request(
      "POST",
      `/v1/projects/${projectId}/upload-intents`,
      uploadIntentResponseSchema,
      { contentType: input.contentType, bytes: input.bytes },
      `intent:${projectId}:${input.fileName}:${input.bytes}`,
    );
  }

  confirmAsset(
    assetId: string,
    input: { bytes: number; sha256: string },
  ): Promise<{ data: { assetId: string; status: "READY" } }> {
    return this.request(
      "POST",
      `/v1/assets/${assetId}/confirm`,
      confirmAssetResponseSchema,
      input,
      `confirm:${assetId}`,
    );
  }

  setProjectCover(
    projectId: string,
    assetId: string,
  ): Promise<{ data: { projectId: string; coverAssetId: string } }> {
    return this.request(
      "POST",
      `/v1/projects/${projectId}/cover`,
      setCoverResponseSchema,
      { assetId },
      `cover:${projectId}`,
    );
  }

  /**
   * Direct PUT to the short-lived signed URL. This bypasses the JSON/zod
   * pipeline and the API idempotency-key store on purpose; the storage
   * backend only accepts the headers issued by the upload intent.
   */
  async uploadToSignedUrl(
    uploadUrl: string,
    headers: Record<string, string>,
    file: Blob,
  ): Promise<void> {
    const response = await this.impl(uploadUrl, {
      method: "PUT",
      headers,
      body: file,
      credentials: "omit",
    });
    if (!response.ok) {
      throw new ApiProblemError(
        response.status,
        `HTTP_${response.status}`,
        "Signed upload failed.",
      );
    }
  }

  eventsUrl(workflowRunId: string): string {
    return `${this.base}/v1/workflow-runs/${workflowRunId}/events`;
  }
}
