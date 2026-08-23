import type { Pool } from "pg";
import type {
  ExportPackageRecord,
  ExportPackageStorePort,
} from "../ports.js";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PgExportPackageStore implements ExportPackageStorePort {
  constructor(private readonly pool: Pool) {}

  async getProjectOwnerId(projectId: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      "SELECT user_id FROM projects WHERE id = $1::uuid",
      [projectId],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async findLatest(projectId: string): Promise<ExportPackageRecord | null> {
    const result = await this.pool.query<{
      id: string;
      project_id: string;
      package_key: string;
      sha256: string;
      duration_ms: number;
      bytes: number;
      created_at: Date | string;
    }>(
      `SELECT id, project_id, package_key, sha256, duration_ms, bytes, created_at
         FROM export_packages
        WHERE project_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 1`,
      [projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      objectKey: row.package_key,
      sha256: row.sha256,
      durationMs: row.duration_ms,
      bytes: row.bytes,
      createdAt: toIso(row.created_at),
    };
  }
}
