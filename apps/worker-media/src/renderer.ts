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
  readonly durationMs: number;
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
    motionObjectKey: string;
    motionAssetId: string;
  }): Promise<RenderArtifacts>;
}

const MOTION_FRAMES = 24;
const FAKE_MOTION_DURATION_MS = 1500;

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
    motionObjectKey: string;
    motionAssetId: string;
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
      durationMs: FAKE_MOTION_DURATION_MS,
      manifest: {
        schemaVersion: "1",
        recipeVersion: this.recipeVersion,
        seed,
        durationMs: FAKE_MOTION_DURATION_MS,
        coverSha256: sha256Hex(cover),
        motionSha256: sha256Hex(motion),
      },
    };
  }
}

export class FfmpegExportRenderer implements ExportRenderer {
  readonly recipeVersion = "cover-replacement.v3";

  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly ffmpegPath = "ffmpeg",
    private readonly ffprobePath = "ffprobe",
  ) {}

  async render(input: {
    projectId: string;
    selectedOutputId: string;
    sourceObjectKey: string;
    sourceWidth: number;
    sourceHeight: number;
    motionObjectKey: string;
    motionAssetId: string;
  }): Promise<RenderArtifacts> {
    const directory = await mkdtemp(join(tmpdir(), "live-photo-render-"));
    const sourcePath = join(directory, "source-image");
    const coverPath = join(directory, "cover.jpg");
    const motionPath = join(directory, "motion.mov");
    const width = evenDimension(input.sourceWidth);
    const height = evenDimension(input.sourceHeight);

    try {
      const [source, motion] = await Promise.all([
        this.storage.getObject(input.sourceObjectKey),
        this.storage.getObject(input.motionObjectKey),
      ]);
      assertQuickTimeMovie(motion);
      await Promise.all([
        writeFile(sourcePath, source),
        writeFile(motionPath, motion),
      ]);
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
      const [cover, motionMetadata] = await Promise.all([
        readFile(coverPath),
        probeQuickTimeMovie(this.ffprobePath, motionPath),
      ]);
      assertJpeg(cover);
      return {
        cover,
        motion,
        durationMs: motionMetadata.durationMs,
        manifest: {
          schemaVersion: "1",
          recipeVersion: this.recipeVersion,
          sourceOutputId: input.selectedOutputId,
          motionSourceAssetId: input.motionAssetId,
          motionPassthrough: true,
          durationMs: motionMetadata.durationMs,
          coverWidth: width,
          coverHeight: height,
          motionWidth: motionMetadata.width,
          motionHeight: motionMetadata.height,
          frameRate: motionMetadata.frameRate,
          videoCodec: motionMetadata.videoCodec,
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

interface MotionMetadata {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly videoCodec: string;
}

async function probeQuickTimeMovie(
  ffprobePath: string,
  motionPath: string,
): Promise<MotionMetadata> {
  const stdout = await runFfprobe(ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "format=duration:stream=codec_name,width,height,avg_frame_rate",
    "-of",
    "json",
    motionPath,
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("FFPROBE_RESPONSE_INVALID");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("FFPROBE_RESPONSE_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  const streams = record["streams"];
  const format = record["format"];
  const stream =
    Array.isArray(streams) && streams[0] && typeof streams[0] === "object"
      ? (streams[0] as Record<string, unknown>)
      : null;
  const formatRecord =
    format !== null && typeof format === "object"
      ? (format as Record<string, unknown>)
      : null;
  const durationSeconds = Number(formatRecord?.["duration"]);
  const width = Number(stream?.["width"]);
  const height = Number(stream?.["height"]);
  const videoCodec = stream?.["codec_name"];
  const frameRate = parseFrameRate(stream?.["avg_frame_rate"]);
  const durationMs = Math.round(durationSeconds * 1000);
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > 60_000 ||
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1 ||
    typeof videoCodec !== "string" ||
    videoCodec.length === 0 ||
    frameRate <= 0
  ) {
    throw new Error("FFPROBE_RESPONSE_INVALID");
  }
  return { durationMs, width, height, frameRate, videoCodec };
}

function parseFrameRate(value: unknown): number {
  if (typeof value !== "string") return 0;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return 0;
  }
  return numerator / denominator;
}

async function runFfprobe(
  ffprobePath: string,
  args: readonly string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobePath, [...args], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 64 * 1024) {
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => reject(new Error("FFPROBE_UNAVAILABLE")));
    child.once("close", (code) => {
      if (code === 0 && stdoutBytes <= 64 * 1024) {
        resolve(Buffer.concat(chunks).toString("utf8"));
        return;
      }
      reject(new Error("FFPROBE_FAILED"));
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
