import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { ExportPackageService } from "./application/export-package-service.js";

const uuidParamSchema = z.string().uuid();

interface AuthenticatedRequest {
  userId: string;
}

@Controller("v1/projects")
export class ExportPackagesController {
  constructor(
    @Inject(ExportPackageService)
    private readonly exports: ExportPackageService,
  ) {}

  @Get(":projectId/export-packages/latest/download")
  @Header("Cache-Control", "no-store")
  async getLatestDownload(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ): Promise<unknown> {
    const result = await this.exports.getLatestDownload({
      projectId: uuidParamSchema.parse(projectId),
      userId: request.userId,
    });
    return result.body;
  }
}
