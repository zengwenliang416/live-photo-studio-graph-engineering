import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { ExportPackageService } from "./application/export-package-service.js";
import { ExportPackagesController } from "./export-packages.controller.js";
import { EXPORT_TOKENS } from "./export-tokens.js";
import { FakeSignedDownloadPort } from "./infrastructure/fake-signed-download-port.js";
import { PgExportPackageStore } from "./infrastructure/pg-export-package-store.js";
import type { ExportPackageStorePort, SignedDownloadPort } from "./ports.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [ExportPackagesController],
  providers: [
    {
      provide: EXPORT_TOKENS.packageStore,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool): PgExportPackageStore =>
        new PgExportPackageStore(pool),
    },
    {
      provide: EXPORT_TOKENS.signedDownloadPort,
      useFactory: (): FakeSignedDownloadPort => new FakeSignedDownloadPort(),
    },
    {
      provide: ExportPackageService,
      inject: [EXPORT_TOKENS.packageStore, EXPORT_TOKENS.signedDownloadPort],
      useFactory: (
        store: ExportPackageStorePort,
        signer: SignedDownloadPort,
      ): ExportPackageService => new ExportPackageService(store, signer),
    },
  ],
})
export class ExportsModule {}
