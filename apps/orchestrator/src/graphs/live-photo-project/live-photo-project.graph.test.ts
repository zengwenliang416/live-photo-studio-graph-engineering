import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { createMemoryCheckpointer } from "../../checkpointer.js";
import { buildLivePhotoProjectGraphV1 } from "./live-photo-project.graph.js";
import type { WorkflowEffectPort } from "./ports.js";

test("the v1 happy path pauses, resumes and completes", async () => {
  const workflowRunId = randomUUID();
  const projectId = randomUUID();
  const sourceAssetId = randomUUID();
  const coverAssetId = randomUUID();
  const generationJobId = randomUUID();
  const outputId = randomUUID();
  const renderJobId = randomUUID();
  const exportId = randomUUID();
  let completed = false;

  const effects: WorkflowEffectPort = {
    async ensureGenerationBatch() { return { jobId: generationJobId }; },
    async ensureRenderJob() { return { jobId: renderJobId }; },
    async markWorkflowCompleted() { completed = true; },
    async markWorkflowCancelled() {},
    async markWorkflowFailed() {},
  };

  const graph = buildLivePhotoProjectGraphV1({
    projects: {
      async getProjectSnapshot() {
        return {
          projectId,
          userId: "test-user",
          sourceAssetIds: [sourceAssetId],
          coverAssetId,
        };
      },
    },
    effects,
    checkpointer: createMemoryCheckpointer(),
  });
  const config = { configurable: { thread_id: workflowRunId } };

  await graph.invoke({
    workflowRunId,
    projectId,
    userId: "test-user",
    graphKey: "live-photo-project",
    graphVersion: "v1",
    sourceAssetIds: [sourceAssetId],
    coverAssetId,
  }, config);

  await graph.invoke(new Command({ resume: {
    type: "GENERATION_BATCH_COMPLETED",
    correlationId: generationJobId,
    outputIds: [outputId],
  }}), config);

  await graph.invoke(new Command({ resume: {
    action: "SELECT",
    selectedOutputId: outputId,
  }}), config);

  const finalState = await graph.invoke(new Command({ resume: {
    type: "RENDER_JOB_COMPLETED",
    correlationId: renderJobId,
    exportId,
  }}), config);

  assert.equal(finalState.currentPhase, "COMPLETED");
  assert.equal(finalState.exportId, exportId);
  assert.equal(completed, true);
});
