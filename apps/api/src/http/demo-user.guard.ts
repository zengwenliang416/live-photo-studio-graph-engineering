import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { ApplicationProblemError } from "./problem-details.js";

export const USER_ID_HEADER = "x-user-id";

/**
 * Demo-grade identity extraction. The product edition replaces this with real
 * authentication; every workflow query still enforces per-row ownership, so
 * this guard only establishes "some caller is present".
 */
@Injectable()
export class DemoUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      userId?: string;
    }>();
    const raw = request.headers[USER_ID_HEADER];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId || userId.trim().length === 0) {
      throw new ApplicationProblemError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication required.",
        `Header ${USER_ID_HEADER} is required.`,
      );
    }
    request.userId = userId;
    return true;
  }
}
