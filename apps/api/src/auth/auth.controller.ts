import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  AUTH_SESSION_COOKIE_NAME,
  loginRequestSchema,
  registerRequestSchema,
} from "@live-photo-studio/contracts";
import type { AuthConfig } from "../config.js";
import { AuthService } from "./application/auth-service.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import { AUTH_TOKENS } from "./auth-tokens.js";
import { PublicRoute } from "./public-route.js";

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

function sessionCookie(
  token: string,
  expiresAt: string,
  secure: boolean,
): string {
  const expires = new Date(expiresAt);
  const maxAge = Math.max(
    0,
    Math.floor((expires.getTime() - Date.now()) / 1000),
  );
  return [
    `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`,
    `Expires=${expires.toUTCString()}`,
  ]
    .filter((part) => part.length > 0)
    .join("; ");
}

function expiredSessionCookie(secure: boolean): string {
  return [
    `${AUTH_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]
    .filter((part) => part.length > 0)
    .join("; ");
}

@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_TOKENS.config) private readonly config: AuthConfig,
  ) {}

  @PublicRoute()
  @Post("register")
  @Header("Cache-Control", "no-store")
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<unknown> {
    const issued = await this.auth.register(
      registerRequestSchema.parse(body ?? {}),
    );
    response.setHeader(
      "Set-Cookie",
      sessionCookie(
        issued.token,
        issued.response.data.expiresAt,
        this.config.AUTH_COOKIE_SECURE === "true",
      ),
    );
    return issued.response;
  }

  @PublicRoute()
  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<unknown> {
    const issued = await this.auth.login(loginRequestSchema.parse(body ?? {}));
    response.setHeader(
      "Set-Cookie",
      sessionCookie(
        issued.token,
        issued.response.data.expiresAt,
        this.config.AUTH_COOKIE_SECURE === "true",
      ),
    );
    return issued.response;
  }

  @Get("session")
  @Header("Cache-Control", "no-store")
  session(@Req() request: AuthenticatedRequest): unknown {
    return {
      data: {
        user: request.authUser,
        expiresAt: request.sessionExpiresAt,
      },
    };
  }

  @Post("logout")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<unknown> {
    await this.auth.logout(request.sessionId);
    response.setHeader(
      "Set-Cookie",
      expiredSessionCookie(this.config.AUTH_COOKIE_SECURE === "true"),
    );
    return { data: { signedOut: true } };
  }
}
