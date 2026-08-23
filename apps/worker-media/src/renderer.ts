import { createHash } from "node:crypto";
import { z } from "zod";

/** Payload relayed from the orchestrator effect adapter via the Outbox. */
export const renderRequestedPayloadSchema = z.object({
  jobId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  selectedOutputId: z.string().uuid(),
});

export type RenderRequestedPayload = z.infer<typeof renderRequestedPayloadSchema>;

export interface RenderArtifacts {
  readonly cover: Uint8Array;
  readonly motion: Uint8Array;
  readonly manifest: Record<string, unknown>;
}

export interface ExportRenderer {
  /** Recipe identity baked into manifests; bump on output-affecting change. */
  readonly recipeVersion: string;
  render(input: {
    projectId: string;
    selectedOutputId: string;
    durationMs: number;
  }): Promise<RenderArtifacts>;
}

const MOTION_FRAMES = 24;

/**
 * Deterministic renderer for CI and local development: identical inputs
 * always yield byte-identical artifacts and therefore identical hashes.
 */
export class FakeExportRenderer implements ExportRenderer {
  readonly recipeVersion = "v1";

  async render(input: {
    projectId: string;
    selectedOutputId: string;
    durationMs: number;
  }): Promise<RenderArtifacts> {
    const seed = `${input.projectId}:${input.selectedOutputId}`;
    const cover = new TextEncoder().encode(
      JSON.stringify({ kind: "cover-placeholder", seed }),
    );
    const frames: number[] = [];
    for (let i = 0; i < MOTION_FRAMES; i += 1) {
      frames.push(i);
    }
    const motion = new TextEncoder().encode(
      JSON.stringify({ kind: "motion-placeholder", seed, frames }),
    );
    return {
      cover,
      motion,
      manifest: {
        schemaVersion: "1",
        recipeVersion: this.recipeVersion,
        seed,
        durationMs: input.durationMs,
        coverSha256: sha256Hex(cover),
        motionSha256: sha256Hex(motion),
      },
    };
  }
}
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
