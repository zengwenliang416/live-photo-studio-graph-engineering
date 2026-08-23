import { z } from "zod";

/**
 * Payload emitted by the orchestrator's transitional effect adapter through
 * the Transactional Outbox and relayed by the API dispatcher.
 */
export const generationRequestedPayloadSchema = z.object({
  jobId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceAssetIds: z.array(z.string().uuid()).min(1),
  coverAssetId: z.string().uuid(),
  revision: z.number().int().min(0),
});

export type GenerationRequestedPayload = z.infer<
  typeof generationRequestedPayloadSchema
>;

export interface GeneratedCandidate {
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(input: {
    projectId: string;
    sourceAssetIds: readonly string[];
    coverAssetId: string;
    revision: number;
    count: number;
  }): Promise<readonly GeneratedCandidate[]>;
}

const WIDTH = 1024;
const HEIGHT = 1024;

/**
 * Deterministic offline provider for CI and local development. It never
 * touches the network, produces stable storage keys derived from the batch,
 * and keeps the standard CI path free of chargeable model calls.
 */
export class MockImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "mock";

  async generate(input: {
    projectId: string;
    sourceAssetIds: readonly string[];
    coverAssetId: string;
    revision: number;
    count: number;
  }): Promise<readonly GeneratedCandidate[]> {
    const candidates: GeneratedCandidate[] = [];
    for (let index = 0; index < input.count; index += 1) {
      candidates.push({
        storageKey: `projects/${input.projectId}/generations/r${input.revision}/${index}.png`,
        width: WIDTH,
        height: HEIGHT,
      });
    }
    return candidates;
  }
}
