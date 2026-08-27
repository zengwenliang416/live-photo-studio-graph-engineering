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
    security: [{ sessionCookie: [] }],
    paths: {
      "/v1/auth/register": {
        post: {
          summary: "Create a user and issue an authenticated session.",
          operationId: "register",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegisterRequest" },
              },
            },
          },
          responses: {
            "201": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/AuthSession" }),
            ),
            "409": problemResponse("Email already registered."),
            "422": problemResponse("Validation failed."),
          },
        },
      },
      "/v1/auth/login": {
        post: {
          summary: "Verify credentials and issue an authenticated session.",
          operationId: "login",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" },
              },
            },
          },
          responses: {
            "200": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/AuthSession" }),
            ),
            "401": problemResponse("Invalid credentials."),
            "429": problemResponse("Too many sign-in attempts."),
            "422": problemResponse("Validation failed."),
          },
        },
      },
      "/v1/auth/session": {
        get: {
          summary: "Restore the current authenticated session.",
          operationId: "getAuthSession",
          responses: {
            "200": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/AuthSession" }),
            ),
            "401": problemResponse("Authentication required."),
          },
        },
      },
      "/v1/auth/logout": {
        post: {
          summary: "Revoke the current session and clear its cookie.",
          operationId: "logout",
          responses: {
            "200": jsonResponse(
              dataEnvelope({
                type: "object",
                required: ["signedOut"],
                properties: { signedOut: { type: "boolean", enum: [true] } },
              }),
            ),
            "401": problemResponse("Authentication required."),
          },
        },
      },
      "/v1/style-presets": {
        get: {
          summary: "List lightweight style preset metadata.",
          operationId: "listStylePresets",
          responses: {
            "200": jsonResponse(
              dataEnvelope({
                type: "object",
                required: ["items"],
                properties: {
                  items: {
                    type: "array",
                    items: { $ref: "#/components/schemas/StylePresetMetadata" },
                  },
                },
              }),
            ),
            "401": problemResponse("Authentication required."),
          },
        },
      },
      "/v1/style-presets/{key}/prompt": {
        get: {
          summary:
            "Compile the exact model prompt for one style and reference-image count.",
          operationId: "getStylePresetPrompt",
          parameters: [
            {
              name: "key",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "referenceImageCount",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 6,
                default: 1,
              },
            },
          ],
          responses: {
            "200": jsonResponse(
              dataEnvelope({
                $ref: "#/components/schemas/StylePresetPrompt",
              }),
            ),
            "401": problemResponse("Authentication required."),
            "404": problemResponse("Style preset not found."),
            "422": problemResponse("Validation failed."),
          },
        },
      },
      "/v1/projects/{projectId}/workflow-runs": {
        post: {
          summary: "Start a workflow run for a project.",
          operationId: "startWorkflowRun",
          parameters: [idempotencyKeyParameter],
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
      "/v1/projects/{projectId}/export-packages/latest/download": {
        get: {
          summary: "Create a short-lived signed download grant for the latest export.",
          operationId: "getLatestExportDownload",
          parameters: [
            {
              name: "projectId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": jsonResponse(
              dataEnvelope({ $ref: "#/components/schemas/ExportPackageDownloadResult" }),
            ),
            "403": problemResponse("Project access denied."),
            "404": problemResponse("Project or export package not found."),
            "503": problemResponse("Signed download is not available."),
          },
        },
      },
      "/v1/admin/workflow-runs/{workflowRunId}/triage": {
        get: {
          summary: "Read a bounded operator workflow projection.",
          operationId: "getWorkflowTriage",
          parameters: [
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
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "lps_session",
        },
      },
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
        RegisterRequest: {
          type: "object",
          required: ["email", "password", "displayName"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            password: { type: "string", minLength: 12, maxLength: 128 },
            displayName: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
        AuthUser: {
          type: "object",
          required: ["userId", "email", "displayName"],
          properties: {
            userId: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
          },
        },
        AuthSession: {
          type: "object",
          required: ["user", "expiresAt"],
          properties: {
            user: { $ref: "#/components/schemas/AuthUser" },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        StylePresetSource: {
          type: "object",
          required: ["project", "templateId", "promptHash", "previewUrl"],
          properties: {
            project: {
              type: "string",
              enum: ["onepic-template-studio"],
            },
            templateId: { type: "string" },
            promptHash: {
              type: "string",
              pattern: "^[0-9a-f]{64}$",
            },
            previewUrl: {
              type: "string",
              format: "uri",
              nullable: true,
            },
          },
        },
        StylePresetMetadata: {
          type: "object",
          required: [
            "key",
            "name",
            "description",
            "version",
            "category",
            "recommendedFor",
            "recommendedMotion",
            "colorPalette",
            "previewStyle",
            "source",
          ],
          properties: {
            key: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            version: { type: "string" },
            category: { type: "string" },
            recommendedFor: { type: "string" },
            recommendedMotion: { type: "string" },
            colorPalette: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: { type: "string" },
            },
            previewStyle: { type: "string" },
            source: {
              allOf: [{ $ref: "#/components/schemas/StylePresetSource" }],
              nullable: true,
            },
          },
        },
        StylePresetPrompt: {
          type: "object",
          required: [
            "preset",
            "prompt",
            "promptVersion",
            "promptHash",
            "referenceImageCount",
          ],
          properties: {
            preset: { $ref: "#/components/schemas/StylePresetMetadata" },
            prompt: { type: "string" },
            promptVersion: { type: "string" },
            promptHash: {
              type: "string",
              pattern: "^[0-9a-f]{64}$",
            },
            referenceImageCount: {
              type: "integer",
              minimum: 1,
              maximum: 6,
            },
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
            candidates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  outputId: { type: "string", format: "uuid" },
                  previewUrl: { type: "string", format: "uri", nullable: true },
                  previewExpiresAt: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  width: { type: "integer", minimum: 1 },
                  height: { type: "integer", minimum: 1 },
                },
              },
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
        ExportPackageDownloadResult: {
          type: "object",
          required: [
            "exportPackageId",
            "projectId",
            "downloadUrl",
            "expiresAt",
            "sha256",
            "durationMs",
            "bytes",
          ],
          properties: {
            exportPackageId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            downloadUrl: { type: "string", format: "uri" },
            expiresAt: { type: "string", format: "date-time" },
            sha256: { type: "string" },
            durationMs: { type: "integer", minimum: 0 },
            bytes: { type: "integer", minimum: 1 },
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
