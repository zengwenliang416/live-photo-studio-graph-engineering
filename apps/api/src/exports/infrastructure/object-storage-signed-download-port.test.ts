import assert from "node:assert/strict";
import test from "node:test";
import type {
  ObjectStoragePort,
  PutObjectRequest,
  SignedObjectDownload,
  SignedObjectDownloadRequest,
  StoredObject,
} from "@live-photo-studio/storage";
import { ObjectStorageSignedDownloadPort } from "./object-storage-signed-download-port.js";

class FakeObjectStorage implements ObjectStoragePort {
  readonly requests: SignedObjectDownloadRequest[] = [];

  async putObject(_input: PutObjectRequest): Promise<StoredObject> {
    throw new Error("not used");
  }

  async createSignedDownload(
    input: SignedObjectDownloadRequest,
  ): Promise<SignedObjectDownload> {
    this.requests.push(input);
    return {
      url: "https://rustfs.example.test/signed/package.zip",
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
  }
}

test("object-storage download adapter forwards only the object key and TTL", async () => {
  const storage = new FakeObjectStorage();
  const port = new ObjectStorageSignedDownloadPort(storage);

  const result = await port.createSignedDownload({
    exportPackageId: "export-1",
    projectId: "project-1",
    objectKey: "projects/project-1/exports/job-1/package.zip",
    expiresInSeconds: 300,
  });

  assert.equal(result.url, "https://rustfs.example.test/signed/package.zip");
  assert.deepEqual(storage.requests, [
    {
      objectKey: "projects/project-1/exports/job-1/package.zip",
      expiresInSeconds: 300,
    },
  ]);
});
