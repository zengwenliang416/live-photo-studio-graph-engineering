import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";
import { buildStoreZip } from "./zip.js";

function readLocalHeaderCrc(zip: Uint8Array, index: number): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Walk local headers from the start.
  let offset = 0;
  for (let i = 0; i <= index; i += 1) {
    const signature = view.getUint32(offset, true);
    assert.equal(signature, 0x04034b50);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (i === index) return view.getUint32(offset + 14, true);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  throw new Error("entry not found");
}

test("store zip preserves entries and is deterministic", () => {
  const a = new TextEncoder().encode("hello");
  const b = new TextEncoder().encode("manifest-content");
  const entryList = [
    { name: "cover.jpg", bytes: a },
    { name: "manifest.json", bytes: b },
  ];
  const fixed = { timestamp: new Date(Date.UTC(2026, 0, 1)) };
  const first = buildStoreZip(entryList, fixed);
  const second = buildStoreZip(entryList, fixed);
  assert.deepEqual(first, second);

  const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
  assert.ok(first.length > 22);
  assert.equal(view.getUint32(first.length - 22, true), 0x06054b50);

  const expectedA = crc32(a) >>> 0;
  assert.equal(readLocalHeaderCrc(first, 0), expectedA);

  const different = buildStoreZip(
    [{ name: "cover.jpg", bytes: new TextEncoder().encode("hellO") }],
    fixed,
  );
  assert.notEqual(different.length, first.length);
});
