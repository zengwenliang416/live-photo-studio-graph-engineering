import { Pool } from "pg";

export function createAppPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

export interface TransactionHandle {
  readonly client: import("pg").PoolClient;
}

export async function withTransaction<T>(
  pool: Pool,
  work: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
