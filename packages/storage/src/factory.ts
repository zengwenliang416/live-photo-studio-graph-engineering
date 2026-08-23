import type { ObjectStoragePort } from "./ports.js";
import {
  loadObjectStorageEnvironment,
  toS3CompatibleConfig,
} from "./config.js";
import { InMemoryObjectStorage } from "./in-memory-object-storage.js";
import { S3ObjectStorage } from "./s3-object-storage.js";

export function createObjectStorageFromEnvironment(
  environment = loadObjectStorageEnvironment(),
): ObjectStoragePort {
  if (environment.OBJECT_STORAGE_BACKEND === "mock") {
    return new InMemoryObjectStorage();
  }
  return new S3ObjectStorage(toS3CompatibleConfig(environment));
}
