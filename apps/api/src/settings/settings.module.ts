import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import type { ApiConfig } from "../config.js";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { SettingsService } from "./application/settings-service.js";
import { PgSettingsStore } from "./infrastructure/pg-settings-store.js";
import type { SettingsStorePort } from "./ports.js";
import { SettingsController } from "./settings.controller.js";
import { SETTING_TOKENS } from "./setting-tokens.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [SettingsController],
  providers: [
    {
      provide: SETTING_TOKENS.store,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool): SettingsStorePort => new PgSettingsStore(pool),
    },
    {
      provide: SettingsService,
      inject: [SETTING_TOKENS.store, WORKFLOW_TOKENS.config],
      useFactory: (store: SettingsStorePort, config: ApiConfig) =>
        new SettingsService(store, config.SETTINGS_ENCRYPTION_KEY),
    },
  ],
})
export class SettingsModule {}
