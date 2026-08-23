import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_TABLE = "schema_migrations";

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export function listMigrationFiles(migrationsDir: string): readonly string[] {
  return readdirSync(migrationsDir)
    .filter(
      (file) => file.endsWith(".sql") && !file.startsWith("."),
    )
    .sort();
}

export async function runMigrations(
  pool: Pool,
  migrationsDir: string,
): Promise<MigrationResult> {
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    for (const filename of listMigrationFiles(migrationsDir)) {
      const existing = await client.query<{ filename: string }>(
        `SELECT filename FROM ${MIGRATIONS_TABLE} WHERE filename = $1`,
        [filename],
      );
      if (existing.rows.length > 0) {
        skipped.push(filename);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, filename), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`,
          [filename],
        );
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${filename} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } finally {
    client.release();
  }
  return { applied, skipped };
}
