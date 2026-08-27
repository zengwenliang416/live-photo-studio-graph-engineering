import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import type { AssetPreviewRequestedPayload } from "@live-photo-studio/graph-contracts";
import {
  AssetPreviewService,
  type AssetPreviewRenderer,
  type AssetPreviewStorePort,
} from "./asset-preview-service.js";

const ASSET_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const payload: AssetPreviewRequestedPayload = {
  jobId: ASSET_ID,
  projectId: PROJECT_ID,
  assetId: ASSET_ID,
  recipeVersion: "display-preview.v1",
};

class FakeStore implements AssetPreviewStorePort {
  status: "NEW" | "RUNNING" | "SUCCEEDED" | "FAILED" = "NEW";
  completedObjectKey: string | null = null;

  async claim() {
    if (this.status === "SUCCEEDED") {
      return { kind: "ALREADY_DONE" as const };
    }
    this.status = "RUNNING";
    return {
      kind: "CLAIMED" as const,
      source: {
        assetId: ASSET_ID,
        projectId: PROJECT_ID,
        objectKey: `projects/${PROJECT_ID}/originals/${ASSET_ID}`,
        contentType: "image/heic",
      },
    };
  }

  async complete(
    _payload: AssetPreviewRequestedPayload,
    objectKey: string,
  ): Promise<void> {
    this.status = "SUCCEEDED";
    this.completedObjectKey = objectKey;
  }

  async fail(): Promise<void> {
    this.status = "FAILED";
  }
}

class FakeRenderer implements AssetPreviewRenderer {
  calls = 0;

  async render(input: Uint8Array, contentType: string): Promise<Uint8Array> {
    this.calls += 1;
    assert.equal(contentType, "image/heic");
    assert.deepEqual([...input], [1, 2, 3]);
    return Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  }
}

test("asset preview processing is replay-safe and stores a JPEG variant", async () => {
  const storage = new InMemoryObjectStorage();
  await storage.putObject({
    objectKey: `projects/${PROJECT_ID}/originals/${ASSET_ID}`,
    body: Uint8Array.from([1, 2, 3]),
    contentType: "image/heic",
  });
  const store = new FakeStore();
  const renderer = new FakeRenderer();
  const service = new AssetPreviewService(store, storage, renderer);

  assert.equal(await service.process(payload), "SUCCEEDED");
  assert.equal(store.status, "SUCCEEDED");
  assert.equal(renderer.calls, 1);
  assert.equal(
    store.completedObjectKey,
    `projects/${PROJECT_ID}/variants/${ASSET_ID}/display-preview.v1.jpg`,
  );

  assert.equal(await service.process(payload), "ALREADY_DONE");
  assert.equal(renderer.calls, 1);
});
