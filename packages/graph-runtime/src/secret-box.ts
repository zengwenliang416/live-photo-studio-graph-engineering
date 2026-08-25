import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PAYLOAD_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretBoxKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxKeyError";
  }
}

function encode(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function decode(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

export function parseSecretBoxKey(keyHex: string | undefined): Buffer {
  if (keyHex === undefined || !/^[0-9a-fA-F]+$/u.test(keyHex)) {
    throw new SecretBoxKeyError(
      "Secret box key must be a 64-character hex string.",
    );
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxKeyError(
      `Secret box key must decode to ${KEY_BYTES} bytes.`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = parseSecretBoxKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    PAYLOAD_VERSION,
    encode(iv),
    encode(cipher.getAuthTag()),
    encode(ciphertext),
  ].join(".");
}

export function decryptSecret(payload: string, keyHex: string): string {
  const key = parseSecretBoxKey(keyHex);
  const segments = payload.split(".");
  if (segments.length !== 4 || segments[0] !== PAYLOAD_VERSION) {
    throw new Error("Invalid secret box payload format.");
  }
  const iv = decode(segments[1] ?? "");
  const tag = decode(segments[2] ?? "");
  const ciphertext = decode(segments[3] ?? "");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("Invalid secret box payload format.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Secret box authentication failed.");
  }
}
