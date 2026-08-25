import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Put,
  Req,
} from "@nestjs/common";
import { ApplicationProblemError } from "../http/problem-details.js";
import {
  SettingsService,
  type UpsertImageProviderBody,
} from "./application/settings-service.js";
import { upsertImageProviderRequestSchema } from "./request-schemas.js";

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
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settings: SettingsService,
  ) {}

  @Put("settings/image-provider")
  @HttpCode(200)
  async putImageProvider(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    const result = await this.settings.putImageProvider({
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      body: upsertImageProviderRequestSchema.parse(
        body ?? {},
      ) as UpsertImageProviderBody,
    });
    return result.body;
  }

  @Get("settings/image-provider")
  async getImageProvider(
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const result = await this.settings.getImageProvider({
      userId: request.userId,
    });
    return result.body;
  }

  @Delete("settings/image-provider")
  @HttpCode(200)
  async deleteImageProvider(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<unknown> {
    const result = await this.settings.deleteImageProvider({
      userId: request.userId,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
    return result.body;
  }

  @Get("style-presets")
  listStylePresets(): unknown {
    return this.settings.listStylePresets().body;
  }
}
