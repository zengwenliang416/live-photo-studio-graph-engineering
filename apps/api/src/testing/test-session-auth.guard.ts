import type { ExecutionContext } from "@nestjs/common";
import { ApplicationProblemError } from "../http/problem-details.js";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";

export const testSessionAuthGuard = {
  canActivate(context: ExecutionContext): boolean {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.headers["x-user-id"];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId) {
      throw new ApplicationProblemError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication required.",
      );
    }
    request.userId = userId;
    request.sessionId = `test-session:${userId}`;
    request.sessionExpiresAt = "2099-01-01T00:00:00.000Z";
    request.authUser = {
      userId: "00000000-0000-4000-8000-000000000001",
      email: "test@example.com",
      displayName: userId,
    };
    return true;
  },
};
