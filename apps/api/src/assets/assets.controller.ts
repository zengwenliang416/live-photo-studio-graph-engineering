import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { ApplicationProblemError } from "../http/problem-details.js";
import {
  AssetUploadService,
  type ConfirmUploadBody,
  type CreateLivePhotoPairBody,
  type SetProjectCoverBody,
  type UploadIntentBody,
} from "./application/asset-upload-service.js";
import {
  confirmUploadRequestSchema,
  createLivePhotoPairRequestSchema,
  setProjectCoverRequestSchema,
  uploadIntentRequestSchema,
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
export class AssetsController {
  constructor(
    @Inject(AssetUploadService)
    private readonly assets: AssetUploadService,
  ) {}

  @Post("projects/:projectId/upload-intents")
  @HttpCode(201)
  async createUploadIntent(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const result = await this.assets.createUploadIntent({
      projectId: uuidParamSchema.parse(projectId),
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: uploadIntentRequestSchema.parse(body ?? {}) as UploadIntentBody,
    });
    return result.body;
  }

  @Post("assets/:assetId/confirm")
  @HttpCode(200)
  async confirmUpload(
    @Req() request: AuthenticatedRequest,
    @Param("assetId") assetId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const result = await this.assets.confirmUpload({
      assetId: uuidParamSchema.parse(assetId),
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: confirmUploadRequestSchema.parse(body ?? {}) as ConfirmUploadBody,
    });
    return result.body;
  }

  @Post("projects/:projectId/cover")
  @HttpCode(200)
  async setProjectCover(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const result = await this.assets.setProjectCover({
      projectId: uuidParamSchema.parse(projectId),
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: setProjectCoverRequestSchema.parse(body ?? {}) as SetProjectCoverBody,
    });
    return result.body;
  }

  @Post("projects/:projectId/live-photo-pairs")
  @HttpCode(201)
  async createLivePhotoPair(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const result = await this.assets.createLivePhotoPair({
      projectId: uuidParamSchema.parse(projectId),
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: createLivePhotoPairRequestSchema.parse(
        body ?? {},
      ) as CreateLivePhotoPairBody,
    });
    return result.body;
  }
}
