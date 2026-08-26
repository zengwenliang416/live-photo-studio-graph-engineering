import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type {
  AuthSessionResponse,
  AuthUser,
  LoginRequest,
  RegisterRequest,
} from "@live-photo-studio/contracts";
import type { AuthConfig } from "../../config.js";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { PasswordHasher } from "../password-hasher.js";
import {
  DuplicateEmailError,
  type AuthSessionRecord,
  type AuthStorePort,
} from "../ports.js";

export interface IssuedSession {
  readonly token: string;
  readonly response: AuthSessionResponse;
}

interface AuthServiceOptions {
  readonly now?: () => Date;
  readonly newUserId?: () => string;
  readonly newSessionId?: () => string;
  readonly newSessionToken?: () => string;
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_THRESHOLD = 5;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function authenticationRequired(): ApplicationProblemError {
  return new ApplicationProblemError(
    401,
    "AUTHENTICATION_REQUIRED",
    "Authentication required.",
  );
}

export class AuthService {
  private readonly now: () => Date;
  private readonly newUserId: () => string;
  private readonly newSessionId: () => string;
  private readonly newSessionToken: () => string;

  constructor(
    private readonly store: AuthStorePort,
    private readonly passwordHasher: PasswordHasher,
    private readonly config: AuthConfig,
    options: AuthServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newUserId = options.newUserId ?? randomUUID;
    this.newSessionId = options.newSessionId ?? randomUUID;
    this.newSessionToken =
      options.newSessionToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async register(input: RegisterRequest): Promise<IssuedSession> {
    const now = this.now();
    const user: AuthUser = {
      userId: this.newUserId(),
      email: input.email,
      displayName: input.displayName,
    };
    const passwordHash = await this.passwordHasher.hash(input.password);
    const issued = this.issueSession(now);
    try {
      await this.store.createUserWithSession({
        user,
        passwordHash,
        sessionId: issued.sessionId,
        tokenHash: sessionTokenHash(issued.token),
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        throw new ApplicationProblemError(
          409,
          "EMAIL_ALREADY_REGISTERED",
          "This email is already registered.",
        );
      }
      throw error;
    }
    return this.toIssuedSession(user, issued.token, issued.expiresAt);
  }

  async login(input: LoginRequest): Promise<IssuedSession> {
    const now = this.now();
    const blockedUntil = await this.store.findLoginBlock({
      emailNormalized: input.email,
      now,
    });
    if (blockedUntil !== null) {
      throw new ApplicationProblemError(
        429,
        "AUTH_LOGIN_RATE_LIMITED",
        "Too many sign-in attempts. Try again later.",
      );
    }

    const identity = await this.store.findIdentityByEmail(input.email);
    const passwordMatches =
      identity === null
        ? await this.consumePasswordWork(input.password)
        : await this.passwordHasher.verify(input.password, identity.passwordHash);
    if (identity === null || !passwordMatches) {
      await this.store.recordLoginFailure({
        emailNormalized: input.email,
        now,
        windowMs: LOGIN_WINDOW_MS,
        threshold: LOGIN_FAILURE_THRESHOLD,
        blockMs: LOGIN_BLOCK_MS,
      });
      throw new ApplicationProblemError(
        401,
        "AUTH_INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    }
    if (identity.status !== "ACTIVE") {
      throw new ApplicationProblemError(
        403,
        "AUTH_ACCOUNT_DISABLED",
        "This account is disabled.",
      );
    }

    const issued = this.issueSession(now);
    await this.store.createSession({
      sessionId: issued.sessionId,
      userId: identity.user.userId,
      tokenHash: sessionTokenHash(issued.token),
      expiresAt: issued.expiresAt,
      maxSessions: this.config.AUTH_MAX_SESSIONS_PER_USER,
    });
    await this.store.clearLoginFailures(input.email);
    return this.toIssuedSession(identity.user, issued.token, issued.expiresAt);
  }

  async authenticate(token: string | undefined): Promise<AuthSessionRecord> {
    if (
      token === undefined ||
      !/^[A-Za-z0-9_-]{43}$/u.test(token)
    ) {
      throw authenticationRequired();
    }
    const now = this.now();
    const session = await this.store.findActiveSession({
      tokenHash: sessionTokenHash(token),
      now,
    });
    if (session === null) {
      throw authenticationRequired();
    }
    const lastSeenAt = new Date(session.lastSeenAt);
    if (
      Number.isFinite(lastSeenAt.getTime()) &&
      now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS
    ) {
      await this.store.touchSession({ sessionId: session.sessionId, now });
    }
    return session;
  }

  async logout(sessionId: string): Promise<void> {
    await this.store.revokeSession({ sessionId, now: this.now() });
  }

  private issueSession(now: Date): {
    readonly sessionId: string;
    readonly token: string;
    readonly expiresAt: Date;
  } {
    return {
      sessionId: this.newSessionId(),
      token: this.newSessionToken(),
      expiresAt: new Date(
        now.getTime() + this.config.AUTH_SESSION_TTL_SECONDS * 1000,
      ),
    };
  }

  private toIssuedSession(
    user: AuthUser,
    token: string,
    expiresAt: Date,
  ): IssuedSession {
    return {
      token,
      response: {
        data: {
          user,
          expiresAt: expiresAt.toISOString(),
        },
      },
    };
  }

  private async consumePasswordWork(password: string): Promise<boolean> {
    await this.passwordHasher.hash(password);
    return false;
  }
}
