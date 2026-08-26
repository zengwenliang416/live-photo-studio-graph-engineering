import type {
  AuthIdentityRecord,
  AuthSessionRecord,
  AuthStorePort,
} from "../ports.js";
import { DuplicateEmailError } from "../ports.js";

interface StoredSession extends AuthSessionRecord {
  readonly tokenHash: string;
  revokedAt: string | null;
  createdAt: string;
}

interface LoginFailure {
  failedCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

export class InMemoryAuthStore implements AuthStorePort {
  readonly identities = new Map<string, AuthIdentityRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly loginFailures = new Map<string, LoginFailure>();

  async createUserWithSession(input: {
    user: AuthIdentityRecord["user"];
    passwordHash: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    if (this.identities.has(input.user.email)) {
      throw new DuplicateEmailError();
    }
    this.identities.set(input.user.email, {
      user: input.user,
      passwordHash: input.passwordHash,
      status: "ACTIVE",
    });
    this.sessions.set(input.tokenHash, {
      sessionId: input.sessionId,
      tokenHash: input.tokenHash,
      user: input.user,
      expiresAt: input.expiresAt.toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  async findIdentityByEmail(
    emailNormalized: string,
  ): Promise<AuthIdentityRecord | null> {
    return this.identities.get(emailNormalized) ?? null;
  }

  async createSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    maxSessions: number;
  }): Promise<void> {
    const identity = [...this.identities.values()].find(
      (candidate) => candidate.user.userId === input.userId,
    );
    if (!identity) throw new Error("Unknown test user.");
    this.sessions.set(input.tokenHash, {
      sessionId: input.sessionId,
      tokenHash: input.tokenHash,
      user: identity.user,
      expiresAt: input.expiresAt.toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });
    const active = [...this.sessions.values()]
      .filter(
        (session) =>
          session.user.userId === input.userId &&
          session.revokedAt === null &&
          new Date(session.expiresAt).getTime() > Date.now(),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const session of active.slice(input.maxSessions)) {
      session.revokedAt = new Date().toISOString();
    }
  }

  async findActiveSession(input: {
    tokenHash: string;
    now: Date;
  }): Promise<AuthSessionRecord | null> {
    const session = this.sessions.get(input.tokenHash);
    if (
      !session ||
      session.revokedAt !== null ||
      new Date(session.expiresAt).getTime() <= input.now.getTime()
    ) {
      return null;
    }
    const identity = this.identities.get(session.user.email);
    if (identity?.status !== "ACTIVE") return null;
    return {
      sessionId: session.sessionId,
      user: session.user,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
    };
  }

  async touchSession(input: { sessionId: string; now: Date }): Promise<void> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.sessionId === input.sessionId,
    );
    if (session) {
      Object.assign(session, { lastSeenAt: input.now.toISOString() });
    }
  }

  async revokeSession(input: { sessionId: string; now: Date }): Promise<void> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.sessionId === input.sessionId,
    );
    if (session && session.revokedAt === null) {
      session.revokedAt = input.now.toISOString();
    }
  }

  async findLoginBlock(input: {
    emailNormalized: string;
    now: Date;
  }): Promise<Date | null> {
    const failure = this.loginFailures.get(input.emailNormalized);
    return failure?.blockedUntil &&
      failure.blockedUntil.getTime() > input.now.getTime()
      ? failure.blockedUntil
      : null;
  }

  async recordLoginFailure(input: {
    emailNormalized: string;
    now: Date;
    windowMs: number;
    threshold: number;
    blockMs: number;
  }): Promise<void> {
    const current = this.loginFailures.get(input.emailNormalized);
    if (
      current?.blockedUntil &&
      current.blockedUntil.getTime() > input.now.getTime()
    ) {
      return;
    }
    const reset =
      !current ||
      input.now.getTime() - current.windowStartedAt.getTime() > input.windowMs;
    const failedCount = reset ? 1 : current.failedCount + 1;
    this.loginFailures.set(input.emailNormalized, {
      failedCount,
      windowStartedAt: reset ? input.now : current.windowStartedAt,
      blockedUntil:
        failedCount >= input.threshold
          ? new Date(input.now.getTime() + input.blockMs)
          : null,
    });
  }

  async clearLoginFailures(emailNormalized: string): Promise<void> {
    this.loginFailures.delete(emailNormalized);
  }
}
