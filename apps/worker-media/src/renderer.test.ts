import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import { FfmpegExportRenderer, sha256Hex } from "./renderer.js";

function ppmImage(width: number, height: number): Uint8Array {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = 210;
    pixels[index + 1] = 130;
    pixels[index + 2] = 45;
  }
  return new Uint8Array(Buffer.concat([header, pixels]));
}

async function createMotionFixture(): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "live-photo-motion-test-"));
  const motionPath = join(directory, "source.mov");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x48:r=30",
        "-t",
        "0.5",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "avc1",
        motionPath,
      ]);
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("TEST_MOV_GENERATION_FAILED"));
      });
    });
    return readFile(motionPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("renderer replaces only the cover and preserves the original MOV bytes", async () => {
  const storage = new InMemoryObjectStorage();
  const sourceObjectKey = "projects/p/generations/r0/0.ppm";
  const motionObjectKey = "projects/p/originals/motion.mov";
  const motion = await createMotionFixture();
  await storage.putObject({
    objectKey: sourceObjectKey,
    body: ppmImage(64, 48),
    contentType: "image/x-portable-pixmap",
  });
  await storage.putObject({
    objectKey: motionObjectKey,
    body: motion,
    contentType: "video/quicktime",
  });
  const renderer = new FfmpegExportRenderer(storage);
  const result = await renderer.render({
    projectId: "p",
    selectedOutputId: "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111",
    sourceObjectKey,
    sourceWidth: 64,
    sourceHeight: 48,
    motionObjectKey,
    motionAssetId: "6e2f6d2e-4f89-4a0c-9b0c-0305e82c2222",
  });

  assert.deepEqual([...result.cover.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual(Buffer.from(result.motion), Buffer.from(motion));
  assert.equal(sha256Hex(result.motion), sha256Hex(motion));
  assert.equal(result.durationMs, 500);
  assert.equal(result.manifest["recipeVersion"], "cover-replacement.v3");
  assert.equal(result.manifest["motionPassthrough"], true);
  assert.equal(result.manifest["videoCodec"], "h264");
  assert.equal(
    result.manifest["motionSourceAssetId"],
    "6e2f6d2e-4f89-4a0c-9b0c-0305e82c2222",
  );
});
