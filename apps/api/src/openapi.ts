interface JsonSchemaRef {
  readonly $ref: string;
}

function problemResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      "application/problem+json": {
        schema: { $ref: "#/components/schemas/ProblemDetails" },
      },
    },
  };
}

function jsonResponse(schema: JsonSchemaRef | Record<string, unknown>): Record<string, unknown> {
  return {
    description: "Success.",
    content: { "application/json": { schema } },
  };
}

const idempotencyKeyParameter = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 16 },
};

const userIdHeaderParameter = {
  name: "x-user-id",
  in: "header",
  required: true,
  schema: { type: "string" },
};

/**
 * Hand-maintained contract surface. The published paths mirror the ExecPlan
 * milestone; request bodies are validated by the Zod schemas at runtime.
 */
export function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
  const dataEnvelope = (schema: Record<string, unknown>) => ({
    type: "object",
    required: ["data"],
    properties: { data: schema },
  });

  return {
    openapi: "3.0.3",
    info: {
      title: "Live Photo Studio API",
      version: "0.1.0",
      description:
        "Workflow command/query boundary. The Graph orchestrator owns phase transitions.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/v1/projects/{projectId}/workflow-runs": {
        post: {
          summary: "Start a workflow run for a project.",
          operationId: "startWorkflowRun",
          parameters: [userIdHeaderParameter, idempotencyKeyParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StartWorkflowRunRequest" },
              },
            },
          },
          responses: {
            "202": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/StartWorkflowRunResult" }),
            ),
            "403": problemResponse("Project access denied."),
            "409": problemResponse("Idempotency key reused."),
            "422": problemResponse("Validation failed."),
          },
        },
      },
      "/v1/workflow-runs/{workflowRunId}": {
        get: {
          summary: "Read the workflow run projection.",
          operationId: "getWorkflowRun",
          parameters: [
            userIdHeaderParameter,
            {
              name: "workflowRunId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": jsonResponse(dataEnvelope({ $ref: "#/components/schemas/WorkflowProjection" })),
            "403": problemResponse("Project access denied."),
            "404": problemResponse("Workflow run not found."),
          },
        },
      },
      "/v1/workflow-runs/{workflowRunId}/human-tasks": {
        get: {
          summary: "List human tasks of a workflow run.",
          operationId: "listHumanTasks",
          parameters: [
            userIdHeaderParameter,
            {
              name: "workflowRunId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": jsonResponse(dataEnvelope({ type: "array", items: { $ref: "#/components/schemas/HumanTaskView" } })),
            "403": problemResponse("Project access denied."),
            "404": problemResponse("Workflow run not found."),
          },
        },
      },
      "/v1/human-tasks/{humanTaskId}/decisions": {
        post: {
          summary: "Submit a decision for a pending human task.",
          operationId: "submitHumanTaskDecision",
          parameters: [
            userIdHeaderParameter,
            idempotencyKeyParameter,
            {
              name: "humanTaskId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HumanTaskDecisionRequest",
                },
              },
            },
          },
          responses: {
            "202": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/HumanTaskDecisionResult" }),
            ),
            "403": problemResponse("Project access denied."),
            "409": problemResponse("Task not pending or key reused."),
            "422": problemResponse("Validation failed."),
          },
        },
      },
      "/v1/workflow-runs/{workflowRunId}/cancel": {
        post: {
          summary: "Request cooperative cancellation of a workflow run.",
          operationId: "cancelWorkflowRun",
          parameters: [
            userIdHeaderParameter,
            idempotencyKeyParameter,
            {
              name: "workflowRunId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CancelWorkflowRunRequest" },
              },
            },
          },
          responses: {
            "202": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/CancelWorkflowRunResult" }),
            ),
            "403": problemResponse("Project access denied."),
            "404": problemResponse("Workflow run not found."),
            "409": problemResponse("Run already terminal or key reused."),
          },
        },
      },
      "/v1/admin/workflow-runs/{workflowRunId}/triage": {
        get: {
          summary: "Read a bounded operator workflow projection.",
          operationId: "getWorkflowTriage",
          parameters: [
            userIdHeaderParameter,
            {
              name: "workflowRunId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/WorkflowTriage" }),
            ),
            "403": problemResponse("Operator access required."),
            "404": problemResponse("Workflow run not found."),
          },
        },
      },
      "/v1/admin/workflow-runs/{workflowRunId}/signals/{signalId}/replay": {
        post: {
          summary: "Replay a persisted signal through the Outbox.",
          operationId: "replayWorkflowSignal",
          parameters: [
            userIdHeaderParameter,
            {
              name: "workflowRunId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "signalId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WorkflowReplayRequest" },
              },
            },
          },
          responses: {
            "202": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/WorkflowReplayResult" }),
            ),
            "403": problemResponse("Operator access required."),
            "404": problemResponse("Workflow run not found."),
            "409": problemResponse("Signal cannot be replayed."),
          },
        },
      },
    },
    components: {
      schemas: {
        ProblemDetails: {
          type: "object",
          required: ["type", "title", "status", "code"],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            code: { type: "string" },
            detail: { type: "string" },
          },
        },
        StartWorkflowRunRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            graphKey: { type: "string", default: "live-photo-project" },
            graphVersion: { type: "string", default: "v1" },
            input: { type: "object", additionalProperties: true },
          },
        },
        StartWorkflowRunResult: {
          type: "object",
          properties: {
            workflowRunId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            graphKey: { type: "string" },
            graphVersion: { type: "string" },
            status: { type: "string", enum: ["QUEUED"] },
            currentPhase: { type: "null" },
          },
        },
        WorkflowProjection: {
          type: "object",
          properties: {
            workflowRunId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            graphKey: { type: "string" },
            graphVersion: { type: "string" },
            status: {
              type: "string",
              enum: ["QUEUED", "RUNNING", "INTERRUPTED", "SUCCEEDED", "FAILED", "CANCELLED"],
            },
            currentNode: { type: "string", nullable: true },
            currentPhase: { type: "string", nullable: true },
            pendingHumanTaskId: { type: "string", format: "uuid", nullable: true },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        HumanTaskView: {
          type: "object",
          properties: {
            humanTaskId: { type: "string", format: "uuid" },
            taskType: { type: "string" },
            nodeName: { type: "string" },
            status: { type: "string" },
            allowedActions: { type: "array", items: { type: "string" } },
            candidateOutputIds: {
              type: "array",
              items: { type: "string", format: "uuid" },
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        HumanTaskDecisionRequest: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["SELECT", "REGENERATE", "CANCEL"] },
            selectedOutputId: { type: "string", format: "uuid" },
            feedback: { type: "string", maxLength: 4000 },
          },
        },
        HumanTaskDecisionResult: {
          type: "object",
          properties: {
            humanTaskId: { type: "string", format: "uuid" },
            status: { type: "string", enum: ["COMPLETED"] },
          },
        },
        CancelWorkflowRunRequest: {
          type: "object",
          additionalProperties: false,
          properties: { reason: { type: "string", maxLength: 500 } },
        },
        CancelWorkflowRunResult: {
          type: "object",
          properties: {
            workflowRunId: { type: "string", format: "uuid" },
            status: { type: "string", enum: ["CANCELLING"] },
          },
        },
        WorkflowReplayRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            reason: { type: "string", maxLength: 500, default: "OPERATOR_REQUESTED" },
          },
        },
        WorkflowReplayResult: {
          type: "object",
          required: ["status", "eventId"],
          properties: {
            status: { type: "string", enum: ["ACCEPTED"] },
            eventId: { type: "string", format: "uuid" },
          },
        },
        WorkflowTriage: {
          type: "object",
          required: [
            "workflowRunId",
            "projectId",
            "status",
            "signals",
            "effects",
            "outbox",
            "metrics",
          ],
          properties: {
            workflowRunId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            traceId: { type: "string", nullable: true },
            status: { type: "string" },
            currentPhase: { type: "string", nullable: true },
            currentNode: { type: "string", nullable: true },
            currentNodeVersion: { type: "integer", nullable: true },
            signals: { type: "array", items: { type: "object" } },
            effects: { type: "array", items: { type: "object" } },
            outbox: { type: "array", items: { type: "object" } },
            metrics: { type: "object" },
          },
        },
      },
    },
  };
}
