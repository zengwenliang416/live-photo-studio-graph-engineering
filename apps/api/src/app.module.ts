import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { RequestOriginGuard } from "./auth/request-origin.guard.js";
import { SessionAuthGuard } from "./auth/session-auth.guard.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { AssetsModule } from "./assets/assets.module.js";
import { ExportsModule } from "./exports/exports.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { WorkflowsModule } from "./workflows/workflows.module.js";

@Module({
  imports: [
    AuthModule,
    WorkflowsModule,
    ExportsModule,
    ProjectsModule,
    AssetsModule,
    SettingsModule,
  ],
  providers: [
    RequestOriginGuard,
    SessionAuthGuard,
    { provide: APP_GUARD, useExisting: RequestOriginGuard },
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
