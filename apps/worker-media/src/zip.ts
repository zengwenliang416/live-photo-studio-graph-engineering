import { crc32 } from "node:zlib";

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    (Math.floor(date.getUTCSeconds() / 2));
  const day =
    ((date.getUTCFullYear() - 1980) << 9) |
    ((date.getUTCMonth() + 1) << 5) |
    date.getUTCDate();
  return { time, date: day };
}

/**
 * Deterministic STORE-method ZIP writer (no compression, no dependencies).
 * Byte-identical inputs with the same timestamp produce byte-identical
 * archives, which keeps export hashes stable across replays.
 */
export function buildStoreZip(
  entries: readonly ZipEntry[],
  options: { timestamp?: Date } = {},
): Uint8Array {
  const { time, date } = dosDateTime(options.timestamp ?? new Date(0));
  type Offset = { entry: ZipEntry; crc: number; offset: number };
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const index: Offset[] = [];

  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.bytes) >>> 0;
    index.push({ entry, crc, offset });
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0, true); // flags
    header.setUint16(8, 0, true); // method: store
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, entry.bytes.length, true);
    header.setUint32(22, entry.bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);
    push(new Uint8Array(header.buffer));
    push(nameBytes);
    push(entry.bytes);
  }

  const centralStart = offset;
  for (const record of index) {
    const nameBytes = new TextEncoder().encode(record.entry.name);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, record.crc, true);
    central.setUint32(20, record.entry.bytes.length, true);
    central.setUint32(24, record.entry.bytes.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, record.offset, true);
    push(new Uint8Array(central.buffer));
    push(nameBytes);
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, offset - centralStart, true);
  end.setUint32(16, centralStart, true);
  push(new Uint8Array(end.buffer));

  const total = offset;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
