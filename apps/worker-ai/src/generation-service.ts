import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WorkflowSignal } from "@live-photo-studio/graph-contracts";
import { compilePrompt, findStylePreset } from "@live-photo-studio/prompt-kit";
import type { ObjectStoragePort } from "@live-photo-studio/storage";
import {
  ProviderFailureError,
  assertProviderBudget,
  type GeneratedCandidate,
  type ImageGenerationProvider,
  type ReferenceImageInput,
} from "./provider.js";
import type { GenerationRequestedPayload } from "./provider.js";

const DEFAULT_STYLE_KEY = "cinematic-portrait";
const MAX_REFERENCE_IMAGES = 6;

type BatchRecord = {
  status: string;
  outputIds: string[];
};

type GenerationPlan = {
  prompt: string;
  referenceImages: ReferenceImageInput[];
  promptVersion: string | null;
  promptHash: string | null;
};

export interface GenerationServiceDeps {
  readonly resolveProvider: (userId: string) => Promise<ImageGenerationProvider>;
  readonly storage: ObjectStoragePort;
}

type ClaimResult =
  | { kind: "CLAIMED" }
  | { kind: "TERMINAL"; outputIds: string[] }
  | { kind: "IN_PROGRESS"; outputIds: string[] };

export class GenerationService {
  constructor(
    private readonly pool: Pool,
    private readonly fallbackProvider: ImageGenerationProvider,
    private readonly candidatesPerBatch = 4,
    private readonly maxCostMicros = 0,
    private readonly deps?: GenerationServiceDeps,
  ) {}

  /**
   * Idempotent batch execution keyed by the orchestrator's jobId. Business
   * rows and the correlated workflow signal share one transaction; duplicate
   * deliveries return the existing outputs and emit nothing.
   */
  async process(payload: GenerationRequestedPayload): Promise<{
    status: "SUCCEEDED" | "ALREADY_DONE" | "IN_PROGRESS" | "FAILED";
    outputIds: readonly string[];
  }> {
    const userId = await this.assertWorkflowInput(payload);
    const provider = this.deps
      ? await this.deps.resolveProvider(userId)
      : this.fallbackProvider;

    let plan: GenerationPlan;
    try {
      plan = await this.buildPlan(payload, provider);
    } catch (error) {
      if (error instanceof ProviderFailureError && !error.retryable) {
        await this.fail(payload, error.code, provider.name);
        return { status: "FAILED", outputIds: [] };
      }
      throw error;
    }

    const claim = await this.claimBatch(payload, provider, plan);
    if (claim.kind === "TERMINAL") {
      return { status: "ALREADY_DONE", outputIds: claim.outputIds };
    }
    if (claim.kind === "IN_PROGRESS") {
      return { status: "IN_PROGRESS", outputIds: claim.outputIds };
    }

    // Provider work must not run inside a database transaction. The job id and
    // durable RUNNING claim prevent duplicate deliveries from invoking the
    // provider concurrently.
    try {
      assertProviderBudget(provider, this.maxCostMicros);
    } catch (error) {
      if (error instanceof ProviderFailureError && !error.retryable) {
        await this.fail(payload, error.code, provider.name);
        return { status: "FAILED", outputIds: [] };
      }
      await this.releaseClaim(payload);
      throw error;
    }

    let candidates: readonly GeneratedCandidate[];
    try {
      candidates = await provider.generate({
        projectId: payload.projectId,
        revision: payload.revision,
        count: this.candidatesPerBatch,
        prompt: plan.prompt,
        referenceImages: plan.referenceImages,
      });
    } catch (error) {
      if (error instanceof ProviderFailureError && !error.retryable) {
        await this.fail(payload, error.code, provider.name);
        return { status: "FAILED", outputIds: [] };
      }
      await this.releaseClaim(payload);
      throw error;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.loadBatchWithClient(client, payload);
      if (!current) {
        throw new Error("GENERATION_JOB_CLAIM_LOST");
      }
      if (current.status === "SUCCEEDED" || current.status === "FAILED") {
        await client.query("COMMIT");
        return { status: "ALREADY_DONE", outputIds: current.outputIds };
      }
      if (current.status !== "RUNNING") {
        await client.query("COMMIT");
        return { status: "IN_PROGRESS", outputIds: current.outputIds };
      }
      const outputIds: string[] = [];
      for (const [index, candidate] of candidates.entries()) {
        const outputId = deterministicUuid(
          `${payload.jobId}:generation-output:${index}`,
        );
        outputIds.push(outputId);
        await client.query(
          `INSERT INTO generation_outputs (id, batch_id, storage_key, width, height)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            outputId,
            payload.jobId,
            candidate.storageKey,
            candidate.width,
            candidate.height,
          ],
        );
      }
      const signal: WorkflowSignal = {
        signalId: deterministicUuid(
          `${payload.jobId}:GENERATION_BATCH_COMPLETED`,
        ),
        workflowRunId: payload.workflowRunId,
        signalType: "GENERATION_BATCH_COMPLETED",
        correlationId: payload.jobId,
        payload: { outputIds },
        emittedAt: new Date().toISOString(),
        traceId: payload.traceId ?? payload.workflowRunId,
        nodeName: "dispatch_generation_v1",
        nodeVersion: 1,
        externalJobId: payload.jobId,
        ...(candidates[0]?.providerRequestId
          ? { providerRequestId: candidates[0].providerRequestId }
          : {}),
      };
      await this.insertOutboxSignal(client, payload.workflowRunId, signal);
      await client.query(
        `UPDATE generation_batches
            SET status = 'SUCCEEDED',
                provider_request_id = COALESCE($2, provider_request_id),
                updated_at = now()
          WHERE id = $1`,
        [payload.jobId, candidates[0]?.providerRequestId ?? null],
      );

      await client.query("COMMIT");
      return { status: "SUCCEEDED", outputIds };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Failure path for classified non-retryable errors: records the failure and
   * emits the correlated failed signal once.
   */
  async fail(
    payload: GenerationRequestedPayload,
    errorCode: string,
    providerName?: string,
  ): Promise<void> {
    await this.assertWorkflowProject(payload);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO generation_batches (id, project_id, workflow_run_id, revision, status, provider, error_code)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, $6)
         ON CONFLICT (id) DO UPDATE
           SET status = 'FAILED', error_code = EXCLUDED.error_code, updated_at = now()
         WHERE generation_batches.status = 'RUNNING'
           AND generation_batches.project_id = EXCLUDED.project_id
           AND generation_batches.workflow_run_id = EXCLUDED.workflow_run_id
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.revision,
          providerName ?? this.fallbackProvider.name,
          errorCode,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query("COMMIT");
        return; // already recorded elsewhere
      }
      const signal: WorkflowSignal = {
        signalId: deterministicUuid(`${payload.jobId}:GENERATION_BATCH_FAILED`),
        workflowRunId: payload.workflowRunId,
        signalType: "GENERATION_BATCH_FAILED",
        correlationId: payload.jobId,
        payload: { errorCode },
        emittedAt: new Date().toISOString(),
        traceId: payload.traceId ?? payload.workflowRunId,
        nodeName: "dispatch_generation_v1",
        nodeVersion: 1,
        externalJobId: payload.jobId,
      };
      await this.insertOutboxSignal(client, payload.workflowRunId, signal);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertWorkflowProject(
    payload: GenerationRequestedPayload,
  ): Promise<string> {
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT user_id
         FROM workflow_runs
        WHERE id = $1::uuid AND project_id = $2::uuid`,
      [payload.workflowRunId, payload.projectId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("WORKFLOW_PROJECT_MISMATCH");
    }
    return row.user_id;
  }

  private async assertWorkflowInput(
    payload: GenerationRequestedPayload,
  ): Promise<string> {
    const userId = await this.assertWorkflowProject(payload);
    const requestedAssetIds = [
      ...new Set([...payload.sourceAssetIds, payload.coverAssetId]),
    ];
    const result = await this.pool.query<{ asset_id: string }>(
      `SELECT asset_id::text AS asset_id
         FROM asset_roles
        WHERE project_id = $1::uuid
          AND asset_id = ANY($2::uuid[])
       UNION
       SELECT cover_asset_id::text AS asset_id
         FROM projects
        WHERE id = $1::uuid
          AND cover_asset_id IS NOT NULL
          AND cover_asset_id = ANY($2::uuid[])`,
      [payload.projectId, requestedAssetIds],
    );
    const ownedAssetIds = new Set(
      result.rows.map((row) => row.asset_id),
    );
    if (
      requestedAssetIds.some((assetId) => !ownedAssetIds.has(assetId))
    ) {
      throw new Error("ASSET_PROJECT_MISMATCH");
    }
    return userId;
  }

  /**
   * Compiles the prompt and loads reference bytes only for providers that
   * declare usesPromptPlan. Mock and test-double providers skip both, so CI
   * never touches storage or prompt compilation.
   */
  private async buildPlan(
    payload: GenerationRequestedPayload,
    provider: ImageGenerationProvider,
  ): Promise<GenerationPlan> {
    if (provider.usesPromptPlan !== true) {
      return {
        prompt: "",
        referenceImages: [],
        promptVersion: null,
        promptHash: null,
      };
    }
    const referenceImages = await this.loadReferenceImages(payload);
    const preset =
      findStylePreset(payload.styleKey ?? DEFAULT_STYLE_KEY) ??
      findStylePreset(DEFAULT_STYLE_KEY);
    if (!preset) {
      throw new ProviderFailureError("STYLE_PRESET_MISSING", false);
    }
    const compiled = compilePrompt({
      preset,
      referenceImageCount: referenceImages.length,
    });
    return {
      prompt: compiled.prompt,
      referenceImages,
      promptVersion: compiled.promptVersion,
      promptHash: compiled.promptHash,
    };
  }

  /**
   * Reference order is part of the model contract: cover first, then the
   * remaining content assets by creation time, capped at the provider limit.
   */
  private async loadReferenceImages(
    payload: GenerationRequestedPayload,
  ): Promise<ReferenceImageInput[]> {
    if (!this.deps) {
      throw new ProviderFailureError("MODEL_PROVIDER_UNCONFIGURED", false);
    }
    const requestedAssetIds = [
      ...new Set([payload.coverAssetId, ...payload.sourceAssetIds]),
    ];
    const result = await this.pool.query<{
      asset_id: string;
      object_key: string;
      content_type: string;
      created_at: string;
    }>(
      `SELECT id::text AS asset_id, object_key, content_type, created_at
         FROM project_assets
        WHERE project_id = $1::uuid
          AND id = ANY($2::uuid[])`,
      [payload.projectId, requestedAssetIds],
    );
    const rows = new Map(result.rows.map((row) => [row.asset_id, row]));
    if (requestedAssetIds.some((assetId) => !rows.has(assetId))) {
      throw new ProviderFailureError("ASSET_OBJECT_MISSING", false);
    }
    const orderedAssetIds = [
      payload.coverAssetId,
      ...requestedAssetIds
        .filter((assetId) => assetId !== payload.coverAssetId)
        .sort((left, right) => {
          const leftRow = rows.get(left);
          const rightRow = rows.get(right);
          return String(leftRow?.created_at).localeCompare(
            String(rightRow?.created_at),
          );
        }),
    ].slice(0, MAX_REFERENCE_IMAGES);

    const images: ReferenceImageInput[] = [];
    for (const assetId of orderedAssetIds) {
      const row = rows.get(assetId);
      if (!row) {
        throw new ProviderFailureError("ASSET_OBJECT_MISSING", false);
      }
      images.push({
        bytes: await this.readAssetBytes(row.object_key),
        contentType: row.content_type,
      });
    }
    return images;
  }

  private async readAssetBytes(objectKey: string): Promise<Uint8Array> {
    if (!this.deps) {
      throw new ProviderFailureError("MODEL_PROVIDER_UNCONFIGURED", false);
    }
    try {
      return await this.deps.storage.getObject(objectKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "OBJECT_STORAGE_NOT_FOUND") {
        throw new ProviderFailureError("ASSET_OBJECT_MISSING", false);
      }
      if (message === "OBJECT_STORAGE_TOO_LARGE") {
        throw new ProviderFailureError("ASSET_OBJECT_TOO_LARGE", false);
      }
      throw error;
    }
  }

  private async claimBatch(
    payload: GenerationRequestedPayload,
    provider: ImageGenerationProvider,
    plan: GenerationPlan,
  ): Promise<ClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO generation_batches (
           id, project_id, workflow_run_id, revision, status, provider,
           prompt_version, prompt_hash, trace_id, provider_request_id, cost_micros
         ) VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6, $7, $8, NULL, $9)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.revision,
          provider.name,
          plan.promptVersion,
          plan.promptHash,
          payload.traceId ?? payload.workflowRunId,
          provider.estimatedCostMicros ?? 0,
        ],
      );
      if ((inserted.rowCount ?? 0) > 0) {
        await client.query("COMMIT");
        return { kind: "CLAIMED" };
      }

      const current = await this.loadBatchWithClient(client, payload);
      if (!current) {
        throw new Error("GENERATION_JOB_CLAIM_LOST");
      }
      await client.query("COMMIT");
      if (current.status === "SUCCEEDED" || current.status === "FAILED") {
        return { kind: "TERMINAL", outputIds: current.outputIds };
      }
      return { kind: "IN_PROGRESS", outputIds: current.outputIds };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseClaim(
    payload: GenerationRequestedPayload,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM generation_batches
        WHERE id = $1::uuid
          AND project_id = $2::uuid
          AND workflow_run_id = $3::uuid
          AND revision = $4
          AND status = 'RUNNING'`,
      [
        payload.jobId,
        payload.projectId,
        payload.workflowRunId,
        payload.revision,
      ],
    );
  }

  private async loadBatchWithClient(
    client: PoolClient,
    payload: GenerationRequestedPayload,
  ): Promise<BatchRecord | null> {
    const result = await client.query<{
      status: string;
      project_id: string;
      workflow_run_id: string | null;
      revision: number;
    }>(
      `SELECT status, project_id, workflow_run_id, revision
         FROM generation_batches
        WHERE id = $1::uuid`,
      [payload.jobId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      row.project_id !== payload.projectId ||
      row.workflow_run_id !== payload.workflowRunId ||
      row.revision !== payload.revision
    ) {
      throw new Error("GENERATION_JOB_SCOPE_MISMATCH");
    }
    const outputs = await client.query<{ id: string }>(
      "SELECT id FROM generation_outputs WHERE batch_id = $1::uuid ORDER BY created_at ASC",
      [payload.jobId],
    );
    return {
      status: row.status,
      outputIds: outputs.rows.map((output) => output.id),
    };
  }

  private async insertOutboxSignal(
    client: import("pg").PoolClient,
    workflowRunId: string,
    signal: WorkflowSignal,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status,
         trace_id, node_name, node_version, external_job_id, provider_request_id
       ) VALUES ($1, 'workflow', $2, $3, $4::jsonb, 'PENDING',
                 $5, $6, $7, $8::uuid, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        signal.signalId,
        workflowRunId,
        signal.signalType,
        JSON.stringify(signal),
        signal.traceId ?? workflowRunId,
        signal.nodeName ?? null,
        signal.nodeVersion ?? null,
        signal.externalJobId ?? null,
        signal.providerRequestId ?? null,
      ],
    );
  }
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
