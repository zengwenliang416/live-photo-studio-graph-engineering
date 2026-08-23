import type { Pool, PoolClient } from "pg";

export class PostgresAdvisoryLock {
  constructor(private readonly pool: Pool) {}

  async withWorkflowLock<T>(
    workflowRunId: string,
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [workflowRunId],
      );
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
