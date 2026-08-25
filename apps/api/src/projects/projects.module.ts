import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { ProjectService } from "./application/project-service.js";
import { PgProjectStore } from "./infrastructure/pg-project-store.js";
import type { ProjectStorePort } from "./ports.js";
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
      provide: ProjectService,
      inject: [PROJECT_TOKENS.store],
      useFactory: (store: ProjectStorePort) => new ProjectService(store),
    },
  ],
})
export class ProjectsModule {}
