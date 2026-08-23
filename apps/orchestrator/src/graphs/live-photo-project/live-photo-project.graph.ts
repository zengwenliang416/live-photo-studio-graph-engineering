import { END, START, StateGraph } from "@langchain/langgraph";
import {
  LivePhotoProjectState,
  type LivePhotoProjectStateValue,
} from "./live-photo-project.state.js";
import { createLivePhotoProjectNodes, NODE_NAMES } from "./nodes.js";
import type { LivePhotoProjectGraphDependencies } from "./ports.js";

function routeAfterGeneration(
  state: LivePhotoProjectStateValue,
): "review" | "failed" {
  return state.currentPhase === "FAILED" ? "failed" : "review";
}

function routeAfterReview(
  state: LivePhotoProjectStateValue,
): "render" | "regenerate" | "cancelled" {
  if (state.reviewAction === "SELECT") {
    return "render";
  }
  if (state.reviewAction === "REGENERATE") {
    return "regenerate";
  }
  return "cancelled";
}

function routeAfterRender(
  state: LivePhotoProjectStateValue,
): "complete" | "failed" {
  return state.currentPhase === "FAILED" ? "failed" : "complete";
}

export function buildLivePhotoProjectGraphV1(
  dependencies: LivePhotoProjectGraphDependencies,
) {
  const nodes = createLivePhotoProjectNodes(dependencies);

  const builder = new StateGraph(LivePhotoProjectState)
    .addNode(NODE_NAMES.loadProject, nodes.loadProject)
    .addNode(NODE_NAMES.dispatchGeneration, nodes.dispatchGeneration)
    .addNode(NODE_NAMES.awaitGeneration, nodes.awaitGeneration)
    .addNode(NODE_NAMES.humanSelectAnchor, nodes.humanSelectAnchor)
    .addNode(NODE_NAMES.dispatchRender, nodes.dispatchRender)
    .addNode(NODE_NAMES.awaitRender, nodes.awaitRender)
    .addNode(NODE_NAMES.complete, nodes.complete)
    .addNode(NODE_NAMES.cancelled, nodes.cancelled)
    .addNode(NODE_NAMES.failed, nodes.failed)
    .addEdge(START, NODE_NAMES.loadProject)
    .addEdge(NODE_NAMES.loadProject, NODE_NAMES.dispatchGeneration)
    .addEdge(NODE_NAMES.dispatchGeneration, NODE_NAMES.awaitGeneration)
    .addConditionalEdges(NODE_NAMES.awaitGeneration, routeAfterGeneration, {
      review: NODE_NAMES.humanSelectAnchor,
      failed: NODE_NAMES.failed,
    })
    .addConditionalEdges(NODE_NAMES.humanSelectAnchor, routeAfterReview, {
      render: NODE_NAMES.dispatchRender,
      regenerate: NODE_NAMES.dispatchGeneration,
      cancelled: NODE_NAMES.cancelled,
    })
    .addEdge(NODE_NAMES.dispatchRender, NODE_NAMES.awaitRender)
    .addConditionalEdges(NODE_NAMES.awaitRender, routeAfterRender, {
      complete: NODE_NAMES.complete,
      failed: NODE_NAMES.failed,
    })
    .addEdge(NODE_NAMES.complete, END)
    .addEdge(NODE_NAMES.cancelled, END)
    .addEdge(NODE_NAMES.failed, END);

  return builder.compile(
    dependencies.checkpointer
      ? { checkpointer: dependencies.checkpointer as never }
      : undefined,
  );
}
