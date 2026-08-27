import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectStoragePort } from "@live-photo-studio/storage";
import {
  renderRequestedPayloadSchema,
  type RenderRequestedPayload,
} from "@live-photo-studio/graph-contracts";

export {
  renderRequestedPayloadSchema,
  type RenderRequestedPayload,
} from "@live-photo-studio/graph-contracts";

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
    sourceObjectKey: string;
    sourceWidth: number;
    sourceHeight: number;
    durationMs: number;
  }): Promise<RenderArtifacts>;
}

const MOTION_FRAMES = 24;
const MOTION_FRAME_RATE = 30;

/**
 * Deterministic renderer for CI and local development: identical inputs
 * always yield byte-identical artifacts and therefore identical hashes.
 */
export class FakeExportRenderer implements ExportRenderer {
  readonly recipeVersion = "v1";

  async render(input: {
    projectId: string;
    selectedOutputId: string;
    sourceObjectKey: string;
    sourceWidth: number;
    sourceHeight: number;
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

export class FfmpegExportRenderer implements ExportRenderer {
  readonly recipeVersion = "ken-burns.v2";

  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly ffmpegPath = "ffmpeg",
  ) {}

  async render(input: {
    projectId: string;
    selectedOutputId: string;
    sourceObjectKey: string;
    sourceWidth: number;
    sourceHeight: number;
    durationMs: number;
  }): Promise<RenderArtifacts> {
    const directory = await mkdtemp(join(tmpdir(), "live-photo-render-"));
    const sourcePath = join(directory, "source-image");
    const coverPath = join(directory, "cover.jpg");
    const motionPath = join(directory, "motion.mov");
    const width = evenDimension(input.sourceWidth);
    const height = evenDimension(input.sourceHeight);

    try {
      const source = await this.storage.getObject(input.sourceObjectKey);
      await writeFile(sourcePath, source);
      await runFfmpeg(this.ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-q:v",
        "2",
        coverPath,
      ]);
      await runFfmpeg(this.ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        String(MOTION_FRAME_RATE),
        "-i",
        coverPath,
        "-vf",
        buildMotionFilter(width, height),
        "-t",
        (input.durationMs / 1000).toFixed(3),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "avc1",
        "-movflags",
        "+faststart",
        motionPath,
      ]);

      const [cover, motion] = await Promise.all([
        readFile(coverPath),
        readFile(motionPath),
      ]);
      assertJpeg(cover);
      assertQuickTimeMovie(motion);
      return {
        cover,
        motion,
        manifest: {
          schemaVersion: "1",
          recipeVersion: this.recipeVersion,
          sourceOutputId: input.selectedOutputId,
          durationMs: input.durationMs,
          width,
          height,
          frameRate: MOTION_FRAME_RATE,
          videoCodec: "h264",
          coverSha256: sha256Hex(cover),
          motionSha256: sha256Hex(motion),
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

function evenDimension(value: number): number {
  if (!Number.isInteger(value) || value < 2 || value > 8192) {
    throw new Error("RENDER_DIMENSION_INVALID");
  }
  return value - (value % 2);
}

export function buildMotionFilter(width: number, height: number): string {
  return [
    "zoompan=",
    "z='min(max(zoom,pzoom)+0.0007,1.035)':",
    "x='iw/2-(iw/zoom/2)':",
    "y='ih/2-(ih/zoom/2)':",
    `d=1:s=${width}x${height}:fps=${MOTION_FRAME_RATE}`,
    ",format=yuv420p",
  ].join("");
}

async function runFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 64 * 1024) {
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => reject(new Error("FFMPEG_UNAVAILABLE")));
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error("FFMPEG_RENDER_FAILED"));
    });
  });
}

function assertJpeg(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    throw new Error("RENDER_COVER_INVALID");
  }
}

function assertQuickTimeMovie(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 12 ||
    String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp"
  ) {
    throw new Error("RENDER_MOTION_INVALID");
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
