import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { ApplicationProblemError } from "../http/problem-details.js";
import {
  ProjectService,
  type CreateProjectBody,
} from "./application/project-service.js";
import {
  createProjectRequestSchema,
  listProjectsQuerySchema,
} from "./request-schemas.js";

const uuidParamSchema = z.string().uuid();

function requireIdempotencyKey(raw: string | undefined): string {
  if (!raw || raw.trim().length < 16) {
    throw new ApplicationProblemError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "An Idempotency-Key header of at least 16 characters is required.",
    );
  }
  return raw;
}

interface AuthenticatedRequest {
  userId: string;
}

@Controller("v1")
export class ProjectsController {
  constructor(
    @Inject(ProjectService)
    private readonly projects: ProjectService,
  ) {}

  @Post("projects")
  @HttpCode(201)
  async createProject(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const result = await this.projects.createProject({
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: createProjectRequestSchema.parse(body ?? {}) as CreateProjectBody,
    });
    return result.body;
  }

  @Get("projects")
  async listProjects(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<unknown> {
    const parsed = listProjectsQuerySchema.parse(query ?? {});
    const result = await this.projects.listProjects({
      userId: request.userId,
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return result.body;
  }

  @Get("projects/:projectId")
  async getProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ): Promise<unknown> {
    const result = await this.projects.getProject({
      projectId: uuidParamSchema.parse(projectId),
      userId: request.userId,
    });
    return result.body;
  }
}
