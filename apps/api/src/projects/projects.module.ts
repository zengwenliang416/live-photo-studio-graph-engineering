import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import {
  createObjectStorageFromEnvironment,
  loadObjectStorageEnvironment,
} from "@live-photo-studio/storage";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { ProjectService } from "./application/project-service.js";
import { PgProjectStore } from "./infrastructure/pg-project-store.js";
import { ObjectStorageProjectPreviewSigner } from "./infrastructure/object-storage-project-preview-signer.js";
import type {
  ProjectPreviewSignerPort,
  ProjectStorePort,
} from "./ports.js";
import { ProjectsController } from "./projects.controller.js";
import { PROJECT_TOKENS } from "./project-tokens.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [ProjectsController],
  providers: [
    {
      provide: PROJECT_TOKENS.store,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool): ProjectStorePort => new PgProjectStore(pool),
    },
    {
      provide: PROJECT_TOKENS.previewSigner,
      useFactory: (): ProjectPreviewSignerPort => {
        const environment = loadObjectStorageEnvironment();
        return new ObjectStorageProjectPreviewSigner(
          createObjectStorageFromEnvironment(environment),
          environment.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS,
        );
      },
    },
    {
      provide: ProjectService,
      inject: [PROJECT_TOKENS.store, PROJECT_TOKENS.previewSigner],
      useFactory: (
        store: ProjectStorePort,
        previewSigner: ProjectPreviewSignerPort,
      ) => new ProjectService(store, previewSigner),
    },
  ],
})
export class ProjectsModule {}
