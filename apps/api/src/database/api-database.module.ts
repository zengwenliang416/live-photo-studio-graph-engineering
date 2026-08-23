import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import type { ApiConfig } from "../config.js";
import { loadApiConfig } from "../config.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";

@Module({
  providers: [
    {
      provide: WORKFLOW_TOKENS.config,
      useFactory: (): ApiConfig => loadApiConfig(),
    },
    {
      provide: WORKFLOW_TOKENS.pool,
      inject: [WORKFLOW_TOKENS.config],
      useFactory: async (config: ApiConfig): Promise<Pool> => {
        const { createAppPool } = await import("@live-photo-studio/database");
        return createAppPool(config.DATABASE_URL);
      },
    },
  ],
  exports: [WORKFLOW_TOKENS.config, WORKFLOW_TOKENS.pool],
})
export class ApiDatabaseModule {}
