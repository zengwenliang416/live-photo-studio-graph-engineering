import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { buildDeterministicUuid } from "@live-photo-studio/graph-runtime";
import { createMemoryCheckpointer } from "./checkpointer.js";
import { buildLivePhotoProjectGraphV1 } from "./graphs/live-photo-project/live-photo-project.graph.js";
import type {
  ProjectReadPort,
  WorkflowEffectPort,
} from "./graphs/live-photo-project/ports.js";

const ids = {
  workflowRunId: randomUUID(),
  projectId: randomUUID(),
  userId: "demo-user",
  sourceAssetId: randomUUID(),
  coverAssetId: randomUUID(),
  generationJobId: randomUUID(),
  outputId: randomUUID(),
  renderJobId: randomUUID(),
  exportId: randomUUID(),
};
const humanTaskId = buildDeterministicUuid(
  `${ids.workflowRunId}:human_select_anchor_v1:0`,
);

const projects: ProjectReadPort = {
  async getProjectSnapshot() {
    return {
      projectId: ids.projectId,
      userId: ids.userId,
      sourceAssetIds: [ids.sourceAssetId],
      coverAssetId: ids.coverAssetId,
    };
  },
};

const effects: WorkflowEffectPort = {
  async ensureGenerationBatch() {
    return { jobId: ids.generationJobId };
  },
  async ensureRenderJob() {
    return { jobId: ids.renderJobId };
  },
  async markWorkflowCompleted() {},
  async markWorkflowCancelled() {},
  async markWorkflowFailed() {},
};

const graph = buildLivePhotoProjectGraphV1({
  projects,
  effects,
  checkpointer: createMemoryCheckpointer(),
});
const config = { configurable: { thread_id: ids.workflowRunId } };

let state = await graph.invoke(
  {
    workflowRunId: ids.workflowRunId,
    projectId: ids.projectId,
    userId: ids.userId,
    graphKey: "live-photo-project",
    graphVersion: "v1",
    sourceAssetIds: [ids.sourceAssetId],
    coverAssetId: ids.coverAssetId,
  },
  config,
);
console.info("1. Waiting for generation:", state.currentPhase);

state = await graph.invoke(
  new Command({
    resume: {
      type: "GENERATION_BATCH_COMPLETED",
      correlationId: ids.generationJobId,
      outputIds: [ids.outputId],
    },
  }),
  config,
);
console.info("2. Waiting for selection:", state.currentPhase);

state = await graph.invoke(
  new Command({
    resume: {
      action: "SELECT",
      correlationId: humanTaskId,
      selectedOutputId: ids.outputId,
    },
  }),
  config,
);
console.info("3. Waiting for render:", state.currentPhase);

state = await graph.invoke(
  new Command({
    resume: {
      type: "RENDER_JOB_COMPLETED",
      correlationId: ids.renderJobId,
      exportId: ids.exportId,
    },
  }),
  config,
);
console.info("4. Completed:", state.currentPhase, state.exportId);
