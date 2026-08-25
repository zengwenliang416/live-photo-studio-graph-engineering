import {
  generationRequestedPayloadSchema,
  type GenerationRequestedPayload,
} from "@live-photo-studio/graph-contracts";

export {
  generationRequestedPayloadSchema,
  type GenerationRequestedPayload,
} from "@live-photo-studio/graph-contracts";

export interface GeneratedCandidate {
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  readonly providerRequestId?: string | undefined;
}

export interface ReferenceImageInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface ImageGenerationInput {
  readonly projectId: string;
  readonly revision: number;
  readonly count: number;
  readonly prompt: string;
  readonly referenceImages: ReadonlyArray<ReferenceImageInput>;
}

export interface ImageGenerationProvider {
  readonly name: string;
  readonly estimatedCostMicros?: number | undefined;
  /**
   * Paid providers set this to receive a compiled prompt and reference image
   * bytes. Providers without the flag (mock, test doubles) get an empty plan
   * and never trigger storage reads or prompt compilation.
   */
  readonly usesPromptPlan?: boolean;
  generate(input: ImageGenerationInput): Promise<readonly GeneratedCandidate[]>;
}

export class ProviderFailureError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "ProviderFailureError";
  }
}

export function assertProviderBudget(
  provider: ImageGenerationProvider,
  maxCostMicros: number,
): void {
  const estimatedCostMicros = provider.estimatedCostMicros ?? 0;
  if (estimatedCostMicros > maxCostMicros) {
    throw new ProviderFailureError("MODEL_BUDGET_EXCEEDED", false);
  }
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
  readonly estimatedCostMicros = 0;

  async generate(
    input: ImageGenerationInput,
  ): Promise<readonly GeneratedCandidate[]> {
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
