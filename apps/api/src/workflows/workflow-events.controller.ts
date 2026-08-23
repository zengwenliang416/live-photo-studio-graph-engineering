import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Req,
  Sse,
} from "@nestjs/common";
import type { Request } from "@nestjs/common";
import { interval, map, mergeMap, type Observable } from "rxjs";
import type { Pool } from "pg";
import type { ApiConfig } from "../config.js";
import { WorkflowService } from "./application/workflow-service.js";
import { WORKFLOW_TOKENS } from "./workflow-tokens.js";

interface AuthenticatedRequest extends Request {
  userId: string;
}

interface EventRow {
  readonly event_name: string;
  readonly payload: unknown;
  readonly created_at: Date;
}

@Controller("v1")
export class WorkflowEventsController {
  constructor(
    @Inject(WorkflowService)
    private readonly workflows: WorkflowService,
    @Inject(WORKFLOW_TOKENS.pool) private readonly pool: Pool,
    @Inject(WORKFLOW_TOKENS.config) private readonly config: ApiConfig,
  ) {}

  /**
   * Transitional SSE transport: tails durable workflow_events for one run.
   * Clients treat payloads as invalidation hints and refetch projections;
   * the projection endpoint remains the only source of truth.
   */
  @Sse("workflow-runs/:workflowRunId/events")
  async events(
    @Req() request: AuthenticatedRequest,
    @Param("workflowRunId") workflowRunId: string,
  ): Promise<Observable<{ data: string }>> {
    void this.config;
    // Ownership gate up front; the stream itself carries no authorization
    // decisions, only invalidation hints for an already-authorized client.
    await this.workflows.getWorkflowRun({
      workflowRunId,
      userId: request.userId,
    });

    let cursor = new Date(Date.now() - 60_000);
    return interval(1000).pipe(
      mergeMap(async () => {
        const result = await this.pool.query<EventRow>(
          `SELECT event_name, payload, created_at
             FROM workflow_events
            WHERE workflow_run_id = $1 AND created_at > $2
            ORDER BY created_at ASC
            LIMIT 50`,
          [workflowRunId, cursor],
        );
        return result.rows;
      }),
      mergeMap((rows) => rows),
      map((row: EventRow) => {
        cursor = row.created_at;
        return {
          data: JSON.stringify({
            eventName: row.event_name,
            occurredAt: row.created_at.toISOString(),
          }),
        };
      }),
    );
  }

  @Get("stream-health")
  health(): string {
    return "ok";
  }
}
