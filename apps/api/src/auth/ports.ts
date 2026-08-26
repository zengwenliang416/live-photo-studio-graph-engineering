import type { AuthUser } from "@live-photo-studio/contracts";

export interface AuthIdentityRecord {
  readonly user: AuthUser;
  readonly passwordHash: string;
  readonly status: "ACTIVE" | "DISABLED";
}

export interface AuthSessionRecord {
  readonly sessionId: string;
  readonly user: AuthUser;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("The normalized email is already registered.");
    this.name = "DuplicateEmailError";
  }
}

export interface AuthStorePort {
  createUserWithSession(input: {
    user: AuthUser;
    passwordHash: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findIdentityByEmail(emailNormalized: string): Promise<AuthIdentityRecord | null>;
  createSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    maxSessions: number;
  }): Promise<void>;
  findActiveSession(input: {
    tokenHash: string;
    now: Date;
  }): Promise<AuthSessionRecord | null>;
  touchSession(input: { sessionId: string; now: Date }): Promise<void>;
  revokeSession(input: { sessionId: string; now: Date }): Promise<void>;
  findLoginBlock(input: {
    emailNormalized: string;
    now: Date;
  }): Promise<Date | null>;
  recordLoginFailure(input: {
    emailNormalized: string;
    now: Date;
    windowMs: number;
    threshold: number;
    blockMs: number;
  }): Promise<void>;
  clearLoginFailures(emailNormalized: string): Promise<void>;
}
