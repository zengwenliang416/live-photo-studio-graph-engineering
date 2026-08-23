import { GraphRegistry } from "@live-photo-studio/graph-runtime";
import type { LivePhotoProjectGraphDependencies } from "./graphs/live-photo-project/ports.js";
import { buildLivePhotoProjectGraphV1 } from "./graphs/live-photo-project/live-photo-project.graph.js";

export function createGraphRegistry(
  dependencies: LivePhotoProjectGraphDependencies,
): GraphRegistry {
  const registry = new GraphRegistry();
  registry.register("live-photo-project", "v1", () =>
    buildLivePhotoProjectGraphV1(dependencies),
  );
  return registry;
}
