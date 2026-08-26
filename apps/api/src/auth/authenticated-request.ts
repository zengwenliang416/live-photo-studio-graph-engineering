import type { AuthUser } from "@live-photo-studio/contracts";

export interface AuthenticatedRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  userId: string;
  sessionId: string;
  sessionExpiresAt: string;
  authUser: AuthUser;
}
