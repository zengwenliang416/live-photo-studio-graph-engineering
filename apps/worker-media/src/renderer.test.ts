import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import {
  buildMotionFilter,
  FfmpegExportRenderer,
} from "./renderer.js";

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

test("ffmpeg renderer emits a real JPEG and QuickTime movie", async () => {
  const storage = new InMemoryObjectStorage();
  const sourceObjectKey = "projects/p/generations/r0/0.ppm";
  await storage.putObject({
    objectKey: sourceObjectKey,
    body: ppmImage(64, 48),
    contentType: "image/x-portable-pixmap",
  });
  const renderer = new FfmpegExportRenderer(storage);
  const result = await renderer.render({
    projectId: "p",
    selectedOutputId: "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111",
    sourceObjectKey,
    sourceWidth: 64,
    sourceHeight: 48,
    durationMs: 500,
  });

  assert.deepEqual([...result.cover.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(
    String.fromCharCode(...result.motion.subarray(4, 8)),
    "ftyp",
  );
  assert.ok(result.motion.byteLength > 1_000);
  assert.equal(result.manifest["recipeVersion"], "ken-burns.v2");
  assert.equal(result.manifest["videoCodec"], "h264");
});

test("motion filter keeps the selected output dimensions", () => {
  assert.match(buildMotionFilter(1448, 1086), /s=1448x1086/u);
  assert.match(buildMotionFilter(1448, 1086), /format=yuv420p/u);
});
