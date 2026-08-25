import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSecret,
  encryptSecret,
  parseSecretBoxKey,
  SecretBoxKeyError,
} from "./secret-box.js";

const KEY = "0".repeat(63) + "1";

test("encrypt/decrypt round trips a secret", () => {
  const payload = encryptSecret("sk-test-secret", KEY);
  assert.equal(decryptSecret(payload, KEY), "sk-test-secret");
});

test("payloads use random IVs", () => {
  assert.notEqual(encryptSecret("same", KEY), encryptSecret("same", KEY));
});

test("tampering with one character fails decryption", () => {
  const payload = encryptSecret("sk-test-secret", KEY);
  const index = payload.length - 1;
  const replacement = payload[index] === "A" ? "B" : "A";
  const tampered = payload.slice(0, index) + replacement;
  assert.throws(() => decryptSecret(tampered, KEY));
});

test("decrypting with a different key fails", () => {
  const payload = encryptSecret("sk-test-secret", KEY);
  const otherKey = "f".repeat(64);
  assert.throws(() => decryptSecret(payload, otherKey));
});

test("malformed payloads are rejected", () => {
  assert.throws(() => decryptSecret("not-a-payload", KEY));
  assert.throws(() => decryptSecret("v2.aaaa.bbbb.cccc", KEY));
  assert.throws(() => decryptSecret("v1..short.", KEY));
});

test("parseSecretBoxKey accepts a 32-byte hex key", () => {
  const key = parseSecretBoxKey(KEY);
  assert.equal(key.length, 32);
});

test("parseSecretBoxKey rejects missing, short and non-hex keys", () => {
  assert.throws(() => parseSecretBoxKey(undefined), SecretBoxKeyError);
  assert.throws(() => parseSecretBoxKey("ab12"), SecretBoxKeyError);
  assert.throws(() => parseSecretBoxKey("z".repeat(64)), SecretBoxKeyError);
});
