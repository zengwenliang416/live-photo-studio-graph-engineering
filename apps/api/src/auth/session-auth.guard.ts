import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_SESSION_COOKIE_NAME } from "@live-photo-studio/contracts";
import { AuthService } from "./application/auth-service.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import { PUBLIC_ROUTE_METADATA } from "./public-route.js";

export function readCookie(
  cookieHeader: string | string[] | undefined,
  name: string,
): string | undefined {
  const raw = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) return true;

    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(
      request.headers["cookie"],
      AUTH_SESSION_COOKIE_NAME,
    );
    const session = await this.auth.authenticate(token);
    request.userId = session.user.userId;
    request.sessionId = session.sessionId;
    request.sessionExpiresAt = session.expiresAt;
    request.authUser = session.user;
    return true;
  }
}
