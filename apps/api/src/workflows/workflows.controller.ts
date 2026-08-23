import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { ApiConfig } from "../config.js";
import { ApplicationProblemError } from "../http/problem-details.js";
import { buildOpenApiDocument } from "../openapi.js";
import {
  WorkflowService,
  type CancelWorkflowRunBody,
  type HumanTaskDecisionBody,
  type StartWorkflowRunBody,
} from "./application/workflow-service.js";
import {
  cancelWorkflowRunRequestSchema,
  humanTaskDecisionRequestSchema,
  startWorkflowRunRequestSchema,
} from "./request-schemas.js";
import { WORKFLOW_TOKENS } from "./workflow-tokens.js";

const uuidParamSchema = z.string().uuid();

function requireIdempotencyKey(raw: string | undefined): string {
  if (!raw || raw.trim().length < 16) {
    throw new ApplicationProblemError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "An Idempotency-Key header of at least 16 characters is required.",
    );
  }
  return raw;
}

function resolveTraceId(raw: string | undefined): string {
  if (raw === undefined) return randomUUID();
  return z.string().uuid().parse(raw);
}

interface AuthenticatedRequest {
  userId: string;
}

@Controller("v1")
export class WorkflowsController {
  constructor(
    @Inject(WorkflowService)
    private readonly workflows: WorkflowService,
    @Inject(WORKFLOW_TOKENS.config) private readonly config: ApiConfig,
  ) {}

  private assertUserId(request: AuthenticatedRequest): string {
    return request.userId;
  }

  private assertFeatureEnabled(userId: string): void {
    if (this.config.GRAPH_WORKFLOW_ENABLED !== "true") {
      throw new ApplicationProblemError(
        404,
        "WORKFLOW_FEATURE_DISABLED",
        "The graph workflow feature is disabled.",
      );
    }
    const canaryUsers = this.config.GRAPH_WORKFLOW_CANARY_USER_IDS
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (canaryUsers.length > 0 && !canaryUsers.includes(userId)) {
      throw new ApplicationProblemError(
        503,
        "LEGACY_WORKFLOW_ROUTE_REQUIRED",
        "The Graph workflow is not enabled for this canary cohort.",
      );
    }
  }

  @Post("projects/:projectId/workflow-runs")
  @HttpCode(202)
  async startWorkflowRun(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-trace-id") traceId: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    this.assertFeatureEnabled(request.userId);
    const result = await this.workflows.startWorkflowRun({
      projectId: uuidParamSchema.parse(projectId),
      userId: this.assertUserId(request),
      traceId: resolveTraceId(traceId),
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: startWorkflowRunRequestSchema.parse(body ?? {}) as StartWorkflowRunBody,
    });
    return result.body;
  }

  @Get("workflow-runs/:workflowRunId")
  async getWorkflowRun(
    @Req() request: AuthenticatedRequest,
    @Param("workflowRunId") workflowRunId: string,
  ): Promise<unknown> {
    const result = await this.workflows.getWorkflowRun({
      workflowRunId: uuidParamSchema.parse(workflowRunId),
      userId: this.assertUserId(request),
    });
    return result.body;
  }

  @Get("workflow-runs/:workflowRunId/human-tasks")
  async listHumanTasks(
    @Req() request: AuthenticatedRequest,
    @Param("workflowRunId") workflowRunId: string,
  ): Promise<unknown> {
    const result = await this.workflows.listHumanTasks({
      workflowRunId: uuidParamSchema.parse(workflowRunId),
      userId: this.assertUserId(request),
    });
    return result.body;
  }

  @Post("human-tasks/:humanTaskId/decisions")
  @HttpCode(202)
  async submitHumanTaskDecision(
    @Req() request: AuthenticatedRequest,
    @Param("humanTaskId") humanTaskId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    this.assertFeatureEnabled(request.userId);
    const parsed =
      humanTaskDecisionRequestSchema.parse(body ?? {}) as HumanTaskDecisionBody;
    const result = await this.workflows.submitHumanTaskDecision({
      humanTaskId: uuidParamSchema.parse(humanTaskId),
      userId: this.assertUserId(request),
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: parsed,
    });
    return result.body;
  }

  @Post("workflow-runs/:workflowRunId/cancel")
  @HttpCode(202)
  async cancelWorkflowRun(
    @Req() request: AuthenticatedRequest,
    @Param("workflowRunId") workflowRunId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    this.assertFeatureEnabled(request.userId);
    const result = await this.workflows.cancelWorkflowRun({
      workflowRunId: uuidParamSchema.parse(workflowRunId),
      userId: this.assertUserId(request),
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: (cancelWorkflowRunRequestSchema.parse(body ?? {}) as CancelWorkflowRunBody),
    });
    return result.body;
  }

  @Get("openapi.json")
  getOpenApi(): Record<string, unknown> {
    return buildOpenApiDocument("/");
  }
}
