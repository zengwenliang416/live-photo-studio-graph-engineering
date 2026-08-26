import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_VERSION = "v1";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await derive(
      password,
      salt,
      SCRYPT_COST,
      SCRYPT_BLOCK_SIZE,
      SCRYPT_PARALLELIZATION,
    );
    return [
      "scrypt",
      SCRYPT_VERSION,
      String(SCRYPT_COST),
      String(SCRYPT_BLOCK_SIZE),
      String(SCRYPT_PARALLELIZATION),
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split("$");
    if (
      parts.length !== 7 ||
      parts[0] !== "scrypt" ||
      parts[1] !== SCRYPT_VERSION
    ) {
      return false;
    }
    const cost = Number(parts[2]);
    const blockSize = Number(parts[3]);
    const parallelization = Number(parts[4]);
    if (
      cost !== SCRYPT_COST ||
      blockSize !== SCRYPT_BLOCK_SIZE ||
      parallelization !== SCRYPT_PARALLELIZATION
    ) {
      return false;
    }
    try {
      const salt = Buffer.from(parts[5] ?? "", "base64url");
      const expected = Buffer.from(parts[6] ?? "", "base64url");
      if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) {
        return false;
      }
      const actual = await derive(
        password,
        salt,
        cost,
        blockSize,
        parallelization,
      );
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
