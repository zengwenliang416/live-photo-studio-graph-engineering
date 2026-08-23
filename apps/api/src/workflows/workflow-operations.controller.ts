import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { WorkflowOperationsService } from "./application/workflow-operations-service.js";

const uuidSchema = z.string().uuid();
const replaySchema = z
  .object({
    reason: z.string().min(1).max(500).default("OPERATOR_REQUESTED"),
  })
  .strict();

interface AuthenticatedRequest {
  userId: string;
}

@Controller("v1/admin")
export class WorkflowOperationsController {
  constructor(
    @Inject(WorkflowOperationsService)
    private readonly operations: WorkflowOperationsService,
  ) {}

  @Get("workflow-runs/:workflowRunId/triage")
  async triage(
    @Req() request: AuthenticatedRequest,
    @Param("workflowRunId") workflowRunId: string,
  ): Promise<unknown> {
    return this.operations.getTriage({
      operatorId: request.userId,
      workflowRunId: uuidSchema.parse(workflowRunId),
    });
  }

  @Post("workflow-runs/:workflowRunId/signals/:signalId/replay")
  @HttpCode(202)
  async replaySignal(
    @Req() request: AuthenticatedRequest,
    @Param("workflowRunId") workflowRunId: string,
    @Param("signalId") signalId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = replaySchema.parse(body ?? {});
    return this.operations.replaySignal({
      operatorId: request.userId,
      workflowRunId: uuidSchema.parse(workflowRunId),
      signalId: uuidSchema.parse(signalId),
      reason: parsed.reason,
    });
  }
}
