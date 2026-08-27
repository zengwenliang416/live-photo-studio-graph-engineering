import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import type { AssetImageVariantRequestedPayload } from "@live-photo-studio/graph-contracts";
import {
  AssetImageVariantService,
  type AssetImageVariantRenderer,
  type AssetImageVariantStorePort,
} from "./asset-image-variant-service.js";

const ASSET_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const previewPayload: AssetImageVariantRequestedPayload = {
  jobId: ASSET_ID,
  projectId: PROJECT_ID,
  assetId: ASSET_ID,
  recipeVersion: "display-preview.v1",
};
const modelInputPayload: AssetImageVariantRequestedPayload = {
  ...previewPayload,
  jobId: "00000000-0000-4000-8000-000000000003",
  recipeVersion: "model-input.v1",
};

class FakeStore implements AssetImageVariantStorePort {
  readonly statuses = new Map<
    AssetImageVariantRequestedPayload["recipeVersion"],
    "NEW" | "RUNNING" | "SUCCEEDED" | "FAILED"
  >();
  readonly completedObjectKeys = new Map<string, string>();

  async claim(payload: AssetImageVariantRequestedPayload) {
    if (this.statuses.get(payload.recipeVersion) === "SUCCEEDED") {
      return { kind: "ALREADY_DONE" as const };
    }
    this.statuses.set(payload.recipeVersion, "RUNNING");
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
    payload: AssetImageVariantRequestedPayload,
    objectKey: string,
  ): Promise<void> {
    this.statuses.set(payload.recipeVersion, "SUCCEEDED");
    this.completedObjectKeys.set(payload.recipeVersion, objectKey);
  }

  async fail(payload: AssetImageVariantRequestedPayload): Promise<void> {
    this.statuses.set(payload.recipeVersion, "FAILED");
  }
}

class FakeRenderer implements AssetImageVariantRenderer {
  readonly recipes: string[] = [];

  async render(
    input: Uint8Array,
    contentType: string,
    recipe: { readonly size: string },
  ): Promise<Uint8Array> {
    this.recipes.push(recipe.size);
    assert.equal(contentType, "image/heic");
    assert.deepEqual([...input], [1, 2, 3]);
    return Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  }
}

test("image variant processing stores separate replay-safe JPEG outputs", async () => {
  const storage = new InMemoryObjectStorage();
  await storage.putObject({
    objectKey: `projects/${PROJECT_ID}/originals/${ASSET_ID}`,
    body: Uint8Array.from([1, 2, 3]),
    contentType: "image/heic",
  });
  const store = new FakeStore();
  const renderer = new FakeRenderer();
  const service = new AssetImageVariantService(store, storage, renderer);

  assert.equal(await service.process(previewPayload), "SUCCEEDED");
  assert.equal(await service.process(modelInputPayload), "SUCCEEDED");
  assert.deepEqual(renderer.recipes, ["1280x1280", "2048x2048"]);
  assert.equal(
    store.completedObjectKeys.get("display-preview.v1"),
    `projects/${PROJECT_ID}/variants/${ASSET_ID}/display-preview.v1.jpg`,
  );
  assert.equal(
    store.completedObjectKeys.get("model-input.v1"),
    `projects/${PROJECT_ID}/variants/${ASSET_ID}/model-input.v1.jpg`,
  );

  assert.equal(await service.process(previewPayload), "ALREADY_DONE");
  assert.equal(await service.process(modelInputPayload), "ALREADY_DONE");
  assert.deepEqual(renderer.recipes, ["1280x1280", "2048x2048"]);
});
