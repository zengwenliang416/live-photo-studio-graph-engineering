import assert from "node:assert/strict";
import test from "node:test";
import { PasswordHasher } from "./password-hasher.js";

test("scrypt hashes use unique salts and verify only the original password", async () => {
  const hasher = new PasswordHasher();
  const first = await hasher.hash("correct horse battery staple");
  const second = await hasher.hash("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(
    await hasher.verify("correct horse battery staple", first),
    true,
  );
  assert.equal(await hasher.verify("wrong password", first), false);
  assert.equal(await hasher.verify("anything", "not-a-valid-hash"), false);
});
