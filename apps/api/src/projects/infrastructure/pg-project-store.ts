import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@live-photo-studio/database";
import {
  IdempotencyConflictError,
  type ProjectAssetRow,
  type ProjectCursor,
  type ProjectRow,
  type ProjectStorePort,
  type ProjectTx,
  type StoredIdempotentResponse,
} from "../ports.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function mapProjectRow(row: Record<string, unknown>): ProjectRow {
  const coverAssetId = row["cover_asset_id"];
  return {
    id: row["id"] as string,
    userId: row["user_id"] as string,
    title: row["title"] as string,
    coverAssetId: typeof coverAssetId === "string" ? coverAssetId : null,
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

function mapAssetRow(row: Record<string, unknown>): ProjectAssetRow {
  const bytes = row["bytes"];
  const previewObjectKey = row["preview_object_key"];
  const previewStatus = row["preview_status"];
  return {
    id: row["id"] as string,
    contentType: row["content_type"] as string,
    bytes: typeof bytes === "number" ? bytes : null,
    status: row["status"] as ProjectAssetRow["status"],
    createdAt: (row["created_at"] as Date).toISOString(),
    previewObjectKey:
      typeof previewObjectKey === "string" ? previewObjectKey : null,
    previewStatus:
      typeof previewStatus === "string"
        ? (previewStatus as NonNullable<ProjectAssetRow["previewStatus"]>)
        : null,
  };
}

export class PgProjectStore implements ProjectStorePort {
  constructor(private readonly pool: Pool) {}

  async transact<T>(work: (tx: ProjectTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.pool, (client) =>
        work(new PgProjectTx(client)),
      );
    } catch (error) {
      // The idempotency primary key turns a concurrent duplicate request into
      // a typed retry signal; the application layer retries and replays.
      if (
        isUniqueViolation(error) &&
        String((error as { constraint?: unknown }).constraint ?? "").startsWith(
          "idempotency_keys_pkey",
        )
      ) {
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}

class PgProjectTx implements ProjectTx {
  constructor(private readonly client: PoolClient) {}

  async insertProject(input: {
    id: string;
    userId: string;
    title: string;
  }): Promise<ProjectRow> {
    const result = await this.client.query<Record<string, unknown>>(
      `INSERT INTO projects (id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, title, cover_asset_id, created_at`,
      [input.id, input.userId, input.title],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("projects insert returned no row.");
    }
    return mapProjectRow(row);
  }

  async findProjectById(projectId: string): Promise<ProjectRow | null> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT id, user_id, title, cover_asset_id, created_at
         FROM projects
        WHERE id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? mapProjectRow(row) : null;
  }

  async listProjectsByUser(input: {
    userId: string;
    limit: number;
    cursor: ProjectCursor | null;
  }): Promise<readonly ProjectRow[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT id, user_id, title, cover_asset_id, created_at
         FROM projects
        WHERE user_id = $1
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [
        input.userId,
        input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null,
        input.limit,
      ],
    );
    return result.rows.map(mapProjectRow);
  }

  async listAssetsByProject(
    projectId: string,
  ): Promise<readonly ProjectAssetRow[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT asset.id,
              asset.content_type,
              asset.bytes,
              asset.status,
              asset.created_at,
              variant.object_key AS preview_object_key,
              variant.status AS preview_status
         FROM project_assets AS asset
         LEFT JOIN asset_variants AS variant
           ON variant.asset_id = asset.id
          AND variant.variant_type = 'DISPLAY_PREVIEW'
          AND variant.recipe_version = 'display-preview.v1'
        WHERE asset.project_id = $1
        ORDER BY asset.created_at ASC, asset.id ASC`,
      [projectId],
    );
    return result.rows.map(mapAssetRow);
  }

  async findIdempotentResponse(
    scope: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<StoredIdempotentResponse | null> {
    const result = await this.client.query<{
      request_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys
        WHERE scope = $1 AND idempotency_key = $2 AND user_id = $3
        FOR UPDATE`,
      [scope, idempotencyKey, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async recordIdempotentResponse(input: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO idempotency_keys (
         scope, idempotency_key, user_id, request_hash,
         response_status, response_body
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.scope,
        input.idempotencyKey,
        input.userId,
        input.requestHash,
        input.responseStatus,
        JSON.stringify(input.responseBody),
      ],
    );
  }
}
