import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { createMemoryCheckpointer } from "../../checkpointer.js";
import {
  buildDeterministicUuid,
  buildNodeEffectKey,
  WorkflowSignalMismatchError,
} from "@live-photo-studio/graph-runtime";
import { buildLivePhotoProjectGraphV1 } from "./live-photo-project.graph.js";
import { livePhotoProjectStartInputSchema } from "./live-photo-project.state.js";
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
    correlationId: buildDeterministicUuid(
      `${workflowRunId}:human_select_anchor_v1:0`,
    ),
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

test("REGENERATE is bounded and routes to the failed terminal node", async () => {
  const workflowRunId = randomUUID();
  const projectId = randomUUID();
  const sourceAssetId = randomUUID();
  const coverAssetId = randomUUID();
  const firstGenerationJobId = randomUUID();
  const secondGenerationJobId = randomUUID();
  const firstOutputId = randomUUID();
  const secondOutputId = randomUUID();
  let failed = false;
  let generationCalls = 0;

  const graph = buildLivePhotoProjectGraphV1({
    maxRepairAttempts: 1,
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
    effects: {
      async ensureGenerationBatch(input) {
        generationCalls += 1;
        return {
          jobId: input.revision === 0
            ? firstGenerationJobId
            : secondGenerationJobId,
        };
      },
      async ensureRenderJob() {
        return { jobId: randomUUID() };
      },
      async markWorkflowCompleted() {},
      async markWorkflowCancelled() {},
      async markWorkflowFailed() {
        failed = true;
      },
    },
    checkpointer: createMemoryCheckpointer(),
  });
  const config = { configurable: { thread_id: workflowRunId } };
  const input = {
    workflowRunId,
    projectId,
    userId: "test-user",
    graphKey: "live-photo-project" as const,
    graphVersion: "v1" as const,
    sourceAssetIds: [sourceAssetId],
    coverAssetId,
  };

  await graph.invoke(input, config);
  await graph.invoke(new Command({ resume: {
    type: "GENERATION_BATCH_COMPLETED",
    correlationId: firstGenerationJobId,
    outputIds: [firstOutputId],
  }}), config);
  await graph.invoke(new Command({ resume: {
    action: "REGENERATE",
    correlationId: buildDeterministicUuid(
      `${workflowRunId}:human_select_anchor_v1:0`,
    ),
  }}), config);
  assert.equal(generationCalls, 2);

  await graph.invoke(new Command({ resume: {
    type: "GENERATION_BATCH_COMPLETED",
    correlationId: secondGenerationJobId,
    outputIds: [secondOutputId],
  }}), config);
  const finalState = await graph.invoke(new Command({ resume: {
    action: "REGENERATE",
    correlationId: buildDeterministicUuid(
      `${workflowRunId}:human_select_anchor_v1:1`,
    ),
  }}), config);

  assert.equal(finalState.currentPhase, "FAILED");
  assert.equal(finalState.lastErrorCode, "REGENERATION_LIMIT_REACHED");
  assert.equal(failed, true);
});

test("a generation resume with the wrong correlation is rejected", async () => {
  const workflowRunId = randomUUID();
  const projectId = randomUUID();
  const sourceAssetId = randomUUID();
  const coverAssetId = randomUUID();
  const generationJobId = randomUUID();

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
    effects: {
      async ensureGenerationBatch() {
        return { jobId: generationJobId };
      },
      async ensureRenderJob() {
        return { jobId: randomUUID() };
      },
      async markWorkflowCompleted() {},
      async markWorkflowCancelled() {},
      async markWorkflowFailed() {},
    },
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

  await assert.rejects(
    graph.invoke(new Command({ resume: {
      type: "GENERATION_BATCH_COMPLETED",
      correlationId: randomUUID(),
      outputIds: [randomUUID()],
    }}), config),
    (error: unknown) => error instanceof WorkflowSignalMismatchError,
  );
});

test("start input styleKey reaches the generation effect and its key", async () => {
  const workflowRunId = randomUUID();
  const projectId = randomUUID();
  const sourceAssetId = randomUUID();
  const coverAssetId = randomUUID();
  const generationJobId = randomUUID();
  const styleKey = "cinematic";
  const generationInputs: {
    styleKey?: string;
    effectKey: string;
  }[] = [];

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
    effects: {
      async ensureGenerationBatch(input) {
        generationInputs.push({
          ...(input.styleKey !== undefined ? { styleKey: input.styleKey } : {}),
          effectKey: input.effectKey,
        });
        return { jobId: generationJobId };
      },
      async ensureRenderJob() {
        return { jobId: randomUUID() };
      },
      async markWorkflowCompleted() {},
      async markWorkflowCancelled() {},
      async markWorkflowFailed() {},
    },
    checkpointer: createMemoryCheckpointer(),
  });
  const config = { configurable: { thread_id: workflowRunId } };

  const state = await graph.invoke({
    workflowRunId,
    projectId,
    userId: "test-user",
    graphKey: "live-photo-project",
    graphVersion: "v1",
    sourceAssetIds: [sourceAssetId],
    coverAssetId,
    styleKey,
  }, config);

  assert.equal(state.styleKey, styleKey);
  assert.equal(generationInputs.length, 1);
  assert.equal(generationInputs[0]?.styleKey, styleKey);
  assert.equal(
    generationInputs[0]?.effectKey,
    buildNodeEffectKey({
      workflowRunId,
      nodeName: "dispatch_generation_v1",
      nodeVersion: 1,
      revision: 0,
      businessInput: {
        sourceAssetIds: [sourceAssetId],
        coverAssetId,
        styleKey,
      },
    }),
  );
});

test("the start input schema validates styleKey additively", () => {
  const base = {
    workflowRunId: randomUUID(),
    projectId: randomUUID(),
    userId: "test-user",
    graphKey: "live-photo-project" as const,
    graphVersion: "v1" as const,
    sourceAssetIds: [randomUUID()],
    coverAssetId: randomUUID(),
  };

  assert.equal(
    livePhotoProjectStartInputSchema.parse(base).styleKey,
    undefined,
  );
  assert.equal(
    livePhotoProjectStartInputSchema.parse({ ...base, styleKey: "cinematic" })
      .styleKey,
    "cinematic",
  );
  assert.equal(
    livePhotoProjectStartInputSchema.safeParse({ ...base, styleKey: "" })
      .success,
    false,
  );
  assert.equal(
    livePhotoProjectStartInputSchema.safeParse({
      ...base,
      styleKey: "x".repeat(65),
    }).success,
    false,
  );
});
