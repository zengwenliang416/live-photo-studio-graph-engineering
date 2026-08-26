import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { AuthConfig } from "../config.js";
import { ApplicationProblemError } from "../http/problem-details.js";
import { AUTH_TOKENS } from "./auth-tokens.js";

interface OriginRequest {
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

function firstHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

@Injectable()
export class RequestOriginGuard implements CanActivate {
  private readonly configuredOrigins: ReadonlySet<string>;

  constructor(
    @Inject(AUTH_TOKENS.config) private readonly config: AuthConfig,
  ) {
    this.configuredOrigins = new Set(
      config.AUTH_ALLOWED_ORIGINS.split(",")
        .map((value) => normalizeOrigin(value.trim()))
        .filter((value): value is string => value !== null),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OriginRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      return true;
    }

    const fetchSite = firstHeader(request.headers["sec-fetch-site"]);
    if (fetchSite === "cross-site") {
      this.reject();
    }

    const rawOrigin = firstHeader(request.headers["origin"]);
    if (rawOrigin === undefined) {
      return true;
    }
    const origin = normalizeOrigin(rawOrigin);
    if (origin === null) {
      this.reject();
    }
    if (this.configuredOrigins.has(origin)) {
      return true;
    }

    const host = firstHeader(
      request.headers["x-forwarded-host"] ?? request.headers["host"],
    );
    const protocol = firstHeader(request.headers["x-forwarded-proto"]) ?? "http";
    if (host !== undefined && origin === normalizeOrigin(`${protocol}://${host}`)) {
      return true;
    }
    this.reject();
  }

  private reject(): never {
    throw new ApplicationProblemError(
      403,
      "CSRF_REQUEST_REJECTED",
      "Cross-site request rejected.",
    );
  }
}
