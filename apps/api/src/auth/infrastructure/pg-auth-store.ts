import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@live-photo-studio/database";
import {
  DuplicateEmailError,
  type AuthIdentityRecord,
  type AuthSessionRecord,
  type AuthStorePort,
} from "../ports.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function isDuplicateEmail(error: unknown): boolean {
  return (
    isUniqueViolation(error) &&
    "constraint" in (error as object) &&
    (error as { constraint?: unknown }).constraint ===
      "users_email_normalized_key"
  );
}

function mapUser(row: Record<string, unknown>) {
  return {
    userId: row["user_id"] as string,
    email: row["email"] as string,
    displayName: row["display_name"] as string,
  };
}

export class PgAuthStore implements AuthStorePort {
  constructor(private readonly pool: Pool) {}

  async createUserWithSession(input: {
    user: { userId: string; email: string; displayName: string };
    passwordHash: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      await withTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO users (
             id, email, email_normalized, display_name
           ) VALUES ($1, $2, $3, $4)`,
          [
            input.user.userId,
            input.user.email,
            input.user.email,
            input.user.displayName,
          ],
        );
        await client.query(
          `INSERT INTO user_password_credentials (user_id, password_hash)
           VALUES ($1, $2)`,
          [input.user.userId, input.passwordHash],
        );
        await this.insertSession(client, input);
      });
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async findIdentityByEmail(
    emailNormalized: string,
  ): Promise<AuthIdentityRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         u.id AS user_id,
         u.email,
         u.display_name,
         u.status,
         c.password_hash
       FROM users u
       JOIN user_password_credentials c ON c.user_id = u.id
       WHERE u.email_normalized = $1`,
      [emailNormalized],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      user: mapUser(row),
      passwordHash: row["password_hash"] as string,
      status: row["status"] as AuthIdentityRecord["status"],
    };
  }

  async createSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    maxSessions: number;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await this.insertSession(client, input);
      await client.query(
        `UPDATE user_sessions
            SET revoked_at = now()
          WHERE id IN (
            SELECT id
              FROM user_sessions
             WHERE user_id = $1
               AND revoked_at IS NULL
               AND expires_at > now()
             ORDER BY created_at DESC, id DESC
             OFFSET $2
          )`,
        [input.userId, input.maxSessions],
      );
    });
  }

  async findActiveSession(input: {
    tokenHash: string;
    now: Date;
  }): Promise<AuthSessionRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         s.id AS session_id,
         s.expires_at,
         s.last_seen_at,
         u.id AS user_id,
         u.email,
         u.display_name
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > $2
         AND u.status = 'ACTIVE'`,
      [input.tokenHash, input.now],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: row["session_id"] as string,
      user: mapUser(row),
      expiresAt: (row["expires_at"] as Date).toISOString(),
      lastSeenAt: (row["last_seen_at"] as Date).toISOString(),
    };
  }

  async touchSession(input: { sessionId: string; now: Date }): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions
          SET last_seen_at = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [input.sessionId, input.now],
    );
  }

  async revokeSession(input: { sessionId: string; now: Date }): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions
          SET revoked_at = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [input.sessionId, input.now],
    );
  }

  async findLoginBlock(input: {
    emailNormalized: string;
    now: Date;
  }): Promise<Date | null> {
    const result = await this.pool.query<{ blocked_until: Date }>(
      `SELECT blocked_until
         FROM auth_login_failures
        WHERE email_normalized = $1
          AND blocked_until > $2`,
      [input.emailNormalized, input.now],
    );
    return result.rows[0]?.blocked_until ?? null;
  }

  async recordLoginFailure(input: {
    emailNormalized: string;
    now: Date;
    windowMs: number;
    threshold: number;
    blockMs: number;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const result = await client.query<{
        failed_count: number;
        window_started_at: Date;
        blocked_until: Date | null;
      }>(
        `SELECT failed_count, window_started_at, blocked_until
           FROM auth_login_failures
          WHERE email_normalized = $1
          FOR UPDATE`,
        [input.emailNormalized],
      );
      const current = result.rows[0];
      if (
        current?.blocked_until &&
        current.blocked_until.getTime() > input.now.getTime()
      ) {
        return;
      }
      const windowExpired =
        current === undefined ||
        input.now.getTime() - current.window_started_at.getTime() >
          input.windowMs;
      const failedCount = windowExpired ? 1 : current.failed_count + 1;
      const windowStartedAt = windowExpired
        ? input.now
        : current.window_started_at;
      const blockedUntil =
        failedCount >= input.threshold
          ? new Date(input.now.getTime() + input.blockMs)
          : null;
      await client.query(
        `INSERT INTO auth_login_failures (
           email_normalized, failed_count, window_started_at,
           blocked_until, updated_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email_normalized) DO UPDATE SET
           failed_count = EXCLUDED.failed_count,
           window_started_at = EXCLUDED.window_started_at,
           blocked_until = EXCLUDED.blocked_until,
           updated_at = EXCLUDED.updated_at`,
        [
          input.emailNormalized,
          failedCount,
          windowStartedAt,
          blockedUntil,
          input.now,
        ],
      );
    });
  }

  async clearLoginFailures(emailNormalized: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM auth_login_failures WHERE email_normalized = $1`,
      [emailNormalized],
    );
  }

  private async insertSession(
    client: PoolClient,
    input: {
      sessionId: string;
      userId?: string;
      user?: { userId: string };
      tokenHash: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    const userId = input.userId ?? input.user?.userId;
    if (userId === undefined) {
      throw new Error("Session user ID is required.");
    }
    await client.query(
      `INSERT INTO user_sessions (
         id, user_id, token_hash, expires_at
       ) VALUES ($1, $2, $3, $4)`,
      [input.sessionId, userId, input.tokenHash, input.expiresAt],
    );
  }
}
