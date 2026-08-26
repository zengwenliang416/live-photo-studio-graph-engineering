import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import type { AuthConfig } from "../config.js";
import { loadAuthConfig } from "../config.js";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { AuthService } from "./application/auth-service.js";
import { AuthController } from "./auth.controller.js";
import { AUTH_TOKENS } from "./auth-tokens.js";
import { PgAuthStore } from "./infrastructure/pg-auth-store.js";
import { PasswordHasher } from "./password-hasher.js";
import type { AuthStorePort } from "./ports.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_TOKENS.config,
      useFactory: (): AuthConfig => loadAuthConfig(),
    },
    PasswordHasher,
    {
      provide: AUTH_TOKENS.store,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool): AuthStorePort => new PgAuthStore(pool),
    },
    {
      provide: AuthService,
      inject: [AUTH_TOKENS.store, PasswordHasher, AUTH_TOKENS.config],
      useFactory: (
        store: AuthStorePort,
        passwordHasher: PasswordHasher,
        config: AuthConfig,
      ): AuthService => new AuthService(store, passwordHasher, config),
    },
  ],
  exports: [AUTH_TOKENS.config, AuthService],
})
export class AuthModule {}
