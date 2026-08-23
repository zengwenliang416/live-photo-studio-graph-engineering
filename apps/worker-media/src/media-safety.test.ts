import assert from "node:assert/strict";
import test from "node:test";
import { stripSensitiveExif, validateMediaInput } from "./media-safety.js";

test("validates MIME against magic bytes and pixel bounds", () => {
  assert.deepEqual(
    validateMediaInput({
      declaredMime: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      width: 100,
      height: 100,
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateMediaInput({
      declaredMime: "image/png",
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      width: 100,
      height: 100,
    }),
    { ok: false, code: "MEDIA_MAGIC_MISMATCH" },
  );
  assert.deepEqual(
    validateMediaInput({
      declaredMime: "image/jpeg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      width: 100_000,
      height: 100_000,
    }),
    { ok: false, code: "MEDIA_PIXEL_LIMIT_EXCEEDED" },
  );
});

test("removes GPS and location metadata before model input", () => {
  assert.deepEqual(
    stripSensitiveExif({
      Camera: "mock",
      GPSLatitude: 1,
      GPSLongitude: 2,
      LocationName: "private",
    }),
    { Camera: "mock" },
  );
});
