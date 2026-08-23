import assert from "node:assert/strict";
import test from "node:test";
import { ExportPackageService } from "./export-package-service.js";
import type {
  ExportPackageRecord,
  ExportPackageStorePort,
  SignedDownloadPort,
  SignedDownloadRequest,
} from "../ports.js";
import { SignedDownloadUnavailableError } from "../ports.js";

const USER = "export-user";
const OTHER_USER = "other-user";
const PROJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const EXPORT_ID = "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111";

const exportPackage: ExportPackageRecord = {
  id: EXPORT_ID,
  projectId: PROJECT_ID,
  objectKey: `projects/${PROJECT_ID}/exports/render-1/package.zip`,
  sha256: "a".repeat(64),
  durationMs: 1500,
  bytes: 42,
  createdAt: new Date().toISOString(),
};

class FakeExportPackageStore implements ExportPackageStorePort {
  ownerId: string | null = USER;
  latest: ExportPackageRecord | null = exportPackage;

  async getProjectOwnerId(): Promise<string | null> {
    return this.ownerId;
  }

  async findLatest(): Promise<ExportPackageRecord | null> {
    return this.latest;
  }
}

class FakeSigner implements SignedDownloadPort {
  readonly requests: SignedDownloadRequest[] = [];
  unavailable = false;

  async createSignedDownload(input: SignedDownloadRequest) {
    this.requests.push(input);
    if (this.unavailable) throw new SignedDownloadUnavailableError();
    return {
      url: "https://storage.example.test/signed/package.zip",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }
}

test("latest export download checks ownership before signing the package key", async () => {
  const store = new FakeExportPackageStore();
  const signer = new FakeSigner();
  const service = new ExportPackageService(store, signer);

  const result = await service.getLatestDownload({
    projectId: PROJECT_ID,
    userId: USER,
  });

  const data = (result.body as { data: Record<string, unknown> }).data;
  assert.equal(result.status, 200);
  assert.equal(data["exportPackageId"], EXPORT_ID);
  assert.equal(data["projectId"], PROJECT_ID);
  assert.equal(data["downloadUrl"], "https://storage.example.test/signed/package.zip");
  assert.equal(signer.requests[0]?.objectKey, exportPackage.objectKey);
  assert.equal(data["objectKey"], undefined);
});

test("foreign project owners cannot request a signed export download", async () => {
  const store = new FakeExportPackageStore();
  const signer = new FakeSigner();
  const service = new ExportPackageService(store, signer);

  await assert.rejects(
    service.getLatestDownload({
      projectId: PROJECT_ID,
      userId: OTHER_USER,
    }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "PROJECT_ACCESS_DENIED",
      );
      return true;
    },
  );
  assert.equal(signer.requests.length, 0);
});

test("missing signing adapter fails closed without returning a persistent URL", async () => {
  const store = new FakeExportPackageStore();
  const signer = new FakeSigner();
  signer.unavailable = true;
  const service = new ExportPackageService(store, signer);

  await assert.rejects(
    service.getLatestDownload({ projectId: PROJECT_ID, userId: USER }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "SIGNED_DOWNLOAD_UNAVAILABLE",
      );
      return true;
    },
  );
});
