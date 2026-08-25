import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import {
  InMemoryObjectStorage,
  loadObjectStorageEnvironment,
  S3ObjectStorage,
  toS3CompatibleConfig,
  type ObjectStoragePort,
} from "@live-photo-studio/storage";
import type { ApiConfig } from "../config.js";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { AssetUploadService } from "./application/asset-upload-service.js";
import { ASSET_TOKENS } from "./asset-tokens.js";
import { AssetsController } from "./assets.controller.js";
import { PgAssetStore } from "./infrastructure/pg-asset-store.js";
import type { AssetStorePort } from "./ports.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [AssetsController],
  providers: [
    {
      provide: ASSET_TOKENS.store,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool): AssetStorePort => new PgAssetStore(pool),
    },
    {
      provide: ASSET_TOKENS.objectStorage,
      useFactory: (): ObjectStoragePort => {
        const environment = loadObjectStorageEnvironment();
        // Non-S3 backends keep uploads in process memory so local development
        // and CI exercise the full confirm flow without real credentials.
        if (environment.OBJECT_STORAGE_BACKEND !== "s3") {
          return new InMemoryObjectStorage();
        }
        return new S3ObjectStorage(toS3CompatibleConfig(environment));
      },
    },
    {
      provide: AssetUploadService,
      inject: [
        ASSET_TOKENS.store,
        ASSET_TOKENS.objectStorage,
        WORKFLOW_TOKENS.config,
      ],
      useFactory: (
        store: AssetStorePort,
        storage: ObjectStoragePort,
        config: ApiConfig,
      ): AssetUploadService => {
        const environment = loadObjectStorageEnvironment();
        return new AssetUploadService(store, storage, {
          uploadMaxBytes: config.UPLOAD_MAX_BYTES,
          signedUploadTtlSeconds:
            environment.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS,
        });
      },
    },
  ],
})
export class AssetsModule {}
