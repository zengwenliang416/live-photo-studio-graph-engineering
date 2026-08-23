import "dotenv/config";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppPool, runMigrations } from "./index.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.length === 0) {
  console.error("Missing environment variable: DATABASE_URL");
  process.exit(1);
}

const migrationsDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "migrations",
);

const pool = createAppPool(DATABASE_URL);
try {
  const result = await runMigrations(pool, migrationsDir);
  console.info(
    JSON.stringify({
      event: "db.migrate.completed",
      applied: result.applied,
      skipped: result.skipped.length,
    }),
  );
} finally {
  await pool.end();
}
