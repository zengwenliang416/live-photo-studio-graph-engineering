import { interrupt } from "@langchain/langgraph";
import { defineGraphNode } from "@live-photo-studio/graph-contracts";
import {
  buildDeterministicUuid,
  buildNodeEffectKey,
  WorkflowSignalMismatchError,
} from "@live-photo-studio/graph-runtime";
import type {
  LivePhotoProjectStateUpdate,
  LivePhotoProjectStateValue,
} from "./live-photo-project.state.js";
import type { LivePhotoProjectGraphDependencies } from "./ports.js";
import {
  anchorDecisionSchema,
  generationSignalSchema,
  renderSignalSchema,
} from "./signal-schemas.js";

export const NODE_NAMES = {
  loadProject: "load_project_v1",
  dispatchGeneration: "dispatch_generation_v1",
  awaitGeneration: "await_generation_v1",
  humanSelectAnchor: "human_select_anchor_v1",
  dispatchRender: "dispatch_render_v1",
  awaitRender: "await_render_v1",
  complete: "complete_v1",
  cancelled: "cancelled_v1",
  failed: "failed_v1",
} as const;

export function createLivePhotoProjectNodes(
  dependencies: LivePhotoProjectGraphDependencies,
) {
  const loadProjectDefinition = defineGraphNode({
    name: NODE_NAMES.loadProject,
    version: 1,
    kind: "DATABASE",
    reads: ["projectId", "userId"],
    writes: [
      "sourceAssetIds",
      "coverAssetId",
      "currentPhase",
      "maxRepairAttempts",
    ],
    sideEffect: false,
    idempotent: true,
  });

  const loadProject = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const snapshot = await dependencies.projects.getProjectSnapshot(
      state.projectId,
      state.userId,
    );
    return {
      sourceAssetIds: [...snapshot.sourceAssetIds],
      coverAssetId: snapshot.coverAssetId,
      currentPhase: "READY_TO_GENERATE",
      maxRepairAttempts:
        dependencies.maxRepairAttempts ?? state.maxRepairAttempts,
    };
  };

  const dispatchGenerationDefinition = defineGraphNode({
    name: NODE_NAMES.dispatchGeneration,
    version: 1,
    kind: "EXTERNAL_JOB",
    reads: [
      "workflowRunId",
      "projectId",
      "sourceAssetIds",
      "coverAssetId",
      "generationRevision",
    ],
    writes: ["pendingExternalJobId", "currentPhase"],
    sideEffect: true,
    idempotent: true,
    timeoutMs: 30_000,
    maxAttempts: 3,
  });

  const dispatchGeneration = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    if (!state.coverAssetId) {
      throw new Error("A cover asset is required before generation.");
    }
    const effectKey = buildNodeEffectKey({
      workflowRunId: state.workflowRunId,
      nodeName: dispatchGenerationDefinition.name,
      nodeVersion: dispatchGenerationDefinition.version,
      revision: state.generationRevision,
      businessInput: {
        sourceAssetIds: state.sourceAssetIds,
        coverAssetId: state.coverAssetId,
      },
    });
    const job = await dependencies.effects.ensureGenerationBatch({
      workflowRunId: state.workflowRunId,
      projectId: state.projectId,
      traceId: state.traceId ?? state.workflowRunId,
      sourceAssetIds: state.sourceAssetIds,
      coverAssetId: state.coverAssetId,
      revision: state.generationRevision,
      effectKey,
    });
    return {
      pendingExternalJobId: job.jobId,
      currentPhase: "WAITING_GENERATION",
      candidateOutputIds: [],
      selectedAnchorOutputId: undefined,
      reviewAction: undefined,
      lastErrorCode: undefined,
    };
  };

  const awaitGenerationDefinition = defineGraphNode({
    name: NODE_NAMES.awaitGeneration,
    version: 1,
    kind: "HUMAN_GATE",
    reads: ["workflowRunId", "pendingExternalJobId"],
    writes: ["candidateOutputIds", "lastErrorCode", "currentPhase"],
    sideEffect: false,
    idempotent: true,
  });

  const awaitGeneration = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const expectedCorrelationId = state.pendingExternalJobId;
    if (!expectedCorrelationId) {
      throw new Error("No generation job is pending.");
    }
    const signal = generationSignalSchema.parse(
      interrupt({
        type: "WAIT_EXTERNAL_JOB",
        workflowRunId: state.workflowRunId,
        nodeName: awaitGenerationDefinition.name,
        correlationId: expectedCorrelationId,
        expectedSignalTypes: [
          "GENERATION_BATCH_COMPLETED",
          "GENERATION_BATCH_FAILED",
        ],
      }),
    );
    if (signal.correlationId !== expectedCorrelationId) {
      throw new WorkflowSignalMismatchError(
        expectedCorrelationId,
        signal.correlationId,
      );
    }
    if (signal.type === "GENERATION_BATCH_FAILED") {
      return {
        lastErrorCode: signal.errorCode,
        currentPhase: "FAILED",
      };
    }
    return {
      candidateOutputIds: signal.outputIds,
      pendingExternalJobId: undefined,
      currentPhase: "REVIEW_ANCHOR",
    };
  };

  const humanSelectAnchorDefinition = defineGraphNode({
    name: NODE_NAMES.humanSelectAnchor,
    version: 1,
    kind: "HUMAN_GATE",
    reads: ["workflowRunId", "candidateOutputIds"],
    writes: [
      "selectedAnchorOutputId",
      "reviewAction",
      "generationRevision",
      "pendingHumanTaskId",
      "lastErrorCode",
      "currentPhase",
    ],
    sideEffect: false,
    idempotent: true,
  });

  const humanSelectAnchor = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const humanTaskId =
      state.pendingHumanTaskId ??
      buildDeterministicUuid(
        `${state.workflowRunId}:${humanSelectAnchorDefinition.name}:${state.generationRevision}`,
      );
    const allowedActions =
      state.generationRevision < state.maxRepairAttempts
        ? (["SELECT", "REGENERATE", "CANCEL"] as const)
        : (["SELECT", "CANCEL"] as const);
    const decision = anchorDecisionSchema.parse(
      interrupt({
        type: "HUMAN_TASK",
        taskType: "SELECT_ANCHOR_IMAGE",
        workflowRunId: state.workflowRunId,
        nodeName: humanSelectAnchorDefinition.name,
        correlationId: humanTaskId,
        humanTaskId,
        candidateOutputIds: state.candidateOutputIds,
        allowedActions,
      }),
    );
    if (decision.correlationId !== humanTaskId) {
      throw new WorkflowSignalMismatchError(humanTaskId, decision.correlationId);
    }
    if (decision.action === "SELECT") {
      if (!state.candidateOutputIds.includes(decision.selectedOutputId)) {
        throw new Error("The selected output does not belong to this workflow.");
      }
      return {
        reviewAction: "SELECT",
        selectedAnchorOutputId: decision.selectedOutputId,
        pendingHumanTaskId: undefined,
        lastErrorCode: undefined,
        currentPhase: "READY_TO_RENDER",
      };
    }
    if (decision.action === "REGENERATE") {
      if (state.generationRevision >= state.maxRepairAttempts) {
        return {
          reviewAction: "REGENERATE",
          lastErrorCode: "REGENERATION_LIMIT_REACHED",
          currentPhase: "FAILED",
        };
      }
      return {
        reviewAction: "REGENERATE",
        generationRevision: state.generationRevision + 1,
        pendingHumanTaskId: undefined,
        lastErrorCode: undefined,
        currentPhase: "READY_TO_GENERATE",
      };
    }
    return {
      reviewAction: "CANCEL",
      pendingHumanTaskId: undefined,
      currentPhase: "CANCELLED",
    };
  };

  const dispatchRenderDefinition = defineGraphNode({
    name: NODE_NAMES.dispatchRender,
    version: 1,
    kind: "EXTERNAL_JOB",
    reads: ["workflowRunId", "projectId", "selectedAnchorOutputId"],
    writes: ["renderJobId", "pendingExternalJobId", "currentPhase"],
    sideEffect: true,
    idempotent: true,
    timeoutMs: 30_000,
    maxAttempts: 3,
  });

  const dispatchRender = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const selectedOutputId = state.selectedAnchorOutputId;
    if (!selectedOutputId) {
      throw new Error("An anchor output must be selected before rendering.");
    }
    const effectKey = buildNodeEffectKey({
      workflowRunId: state.workflowRunId,
      nodeName: dispatchRenderDefinition.name,
      nodeVersion: dispatchRenderDefinition.version,
      revision: state.generationRevision,
      businessInput: { selectedOutputId },
    });
    const job = await dependencies.effects.ensureRenderJob({
      workflowRunId: state.workflowRunId,
      projectId: state.projectId,
      traceId: state.traceId ?? state.workflowRunId,
      selectedOutputId,
      effectKey,
    });
    return {
      renderJobId: job.jobId,
      pendingExternalJobId: job.jobId,
      currentPhase: "WAITING_RENDER",
    };
  };

  const awaitRenderDefinition = defineGraphNode({
    name: NODE_NAMES.awaitRender,
    version: 1,
    kind: "HUMAN_GATE",
    reads: ["workflowRunId", "pendingExternalJobId"],
    writes: ["exportId", "lastErrorCode", "currentPhase"],
    sideEffect: false,
    idempotent: true,
  });

  const awaitRender = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const expectedCorrelationId = state.pendingExternalJobId;
    if (!expectedCorrelationId) {
      throw new Error("No render job is pending.");
    }
    const signal = renderSignalSchema.parse(
      interrupt({
        type: "WAIT_EXTERNAL_JOB",
        workflowRunId: state.workflowRunId,
        nodeName: awaitRenderDefinition.name,
        correlationId: expectedCorrelationId,
        expectedSignalTypes: ["RENDER_JOB_COMPLETED", "RENDER_JOB_FAILED"],
      }),
    );
    if (signal.correlationId !== expectedCorrelationId) {
      throw new WorkflowSignalMismatchError(
        expectedCorrelationId,
        signal.correlationId,
      );
    }
    if (signal.type === "RENDER_JOB_FAILED") {
      return {
        lastErrorCode: signal.errorCode,
        currentPhase: "FAILED",
      };
    }
    return {
      exportId: signal.exportId,
      pendingExternalJobId: undefined,
      currentPhase: "READY_TO_COMPLETE",
    };
  };

  const completeDefinition = defineGraphNode({
    name: NODE_NAMES.complete,
    version: 1,
    kind: "DATABASE",
    reads: ["workflowRunId", "projectId", "exportId"],
    writes: ["currentPhase"],
    sideEffect: true,
    idempotent: true,
  });

  const complete = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    if (!state.exportId) {
      throw new Error("An export is required before completion.");
    }
    const effectKey = buildNodeEffectKey({
      workflowRunId: state.workflowRunId,
      nodeName: completeDefinition.name,
      nodeVersion: completeDefinition.version,
      revision: state.generationRevision,
      businessInput: { exportId: state.exportId },
    });
    await dependencies.effects.markWorkflowCompleted({
      workflowRunId: state.workflowRunId,
      projectId: state.projectId,
      traceId: state.traceId ?? state.workflowRunId,
      exportId: state.exportId,
      effectKey,
    });
    return { currentPhase: "COMPLETED" };
  };

  const cancelledDefinition = defineGraphNode({
    name: NODE_NAMES.cancelled,
    version: 1,
    kind: "COMPENSATION",
    reads: ["workflowRunId", "projectId"],
    writes: ["currentPhase"],
    sideEffect: true,
    idempotent: true,
  });

  const cancelled = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const effectKey = buildNodeEffectKey({
      workflowRunId: state.workflowRunId,
      nodeName: cancelledDefinition.name,
      nodeVersion: cancelledDefinition.version,
      revision: state.generationRevision,
    });
    await dependencies.effects.markWorkflowCancelled({
      workflowRunId: state.workflowRunId,
      projectId: state.projectId,
      traceId: state.traceId ?? state.workflowRunId,
      effectKey,
    });
    return { currentPhase: "CANCELLED" };
  };

  const failedDefinition = defineGraphNode({
    name: NODE_NAMES.failed,
    version: 1,
    kind: "COMPENSATION",
    reads: ["workflowRunId", "projectId", "lastErrorCode"],
    writes: ["currentPhase"],
    sideEffect: true,
    idempotent: true,
  });

  const failed = async (
    state: LivePhotoProjectStateValue,
  ): Promise<LivePhotoProjectStateUpdate> => {
    const errorCode = state.lastErrorCode ?? "WORKFLOW_FAILED";
    const effectKey = buildNodeEffectKey({
      workflowRunId: state.workflowRunId,
      nodeName: failedDefinition.name,
      nodeVersion: failedDefinition.version,
      revision: state.generationRevision,
      businessInput: { errorCode },
    });
    await dependencies.effects.markWorkflowFailed({
      workflowRunId: state.workflowRunId,
      projectId: state.projectId,
      traceId: state.traceId ?? state.workflowRunId,
      errorCode,
      effectKey,
    });
    return { currentPhase: "FAILED" };
  };

  return {
    loadProject,
    dispatchGeneration,
    awaitGeneration,
    humanSelectAnchor,
    dispatchRender,
    awaitRender,
    complete,
    cancelled,
    failed,
  };
}
