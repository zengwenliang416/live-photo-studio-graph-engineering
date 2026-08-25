import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { DemoUserGuard } from "./http/demo-user.guard.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { AssetsModule } from "./assets/assets.module.js";
import { ExportsModule } from "./exports/exports.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { WorkflowsModule } from "./workflows/workflows.module.js";

@Module({
  imports: [WorkflowsModule, ExportsModule, ProjectsModule, AssetsModule],
  providers: [
    { provide: APP_GUARD, useClass: DemoUserGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
