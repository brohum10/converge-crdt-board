import { Pool, type PoolConfig } from "pg";
import type { BoardOperation, SequencedOperation } from "../core/types.js";
import type { OperationStore } from "./store.js";

interface OperationRow {
  cursor: string;
  operation: BoardOperation;
}

export class PostgresOperationJournal implements OperationStore {
  private readonly pool: Pool;

  constructor(config: PoolConfig | string) {
    this.pool = new Pool(typeof config === "string" ? { connectionString: config } : config);
  }

  async load(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS board_operations (
        cursor BIGSERIAL PRIMARY KEY,
        board_id VARCHAR(80) NOT NULL,
        operation_id VARCHAR(170) NOT NULL,
        operation JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (board_id, operation_id)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS board_operations_replay_idx
      ON board_operations (board_id, cursor)
    `);
  }

  async append(boardId: string, operations: BoardOperation[]): Promise<SequencedOperation[]> {
    if (operations.length === 0) return [];
    const client = await this.pool.connect();
    const accepted: SequencedOperation[] = [];

    try {
      await client.query("BEGIN");
      for (const operation of operations) {
        const result = await client.query<OperationRow>(
          `INSERT INTO board_operations (board_id, operation_id, operation)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (board_id, operation_id) DO NOTHING
           RETURNING cursor, operation`,
          [boardId, operation.id, JSON.stringify(operation)],
        );
        const row = result.rows[0];
        if (row) accepted.push({ cursor: Number(row.cursor), operation: row.operation });
      }
      await client.query("COMMIT");
      return accepted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async since(boardId: string, cursor: number): Promise<SequencedOperation[]> {
    const result = await this.pool.query<OperationRow>(
      `SELECT cursor, operation
       FROM board_operations
       WHERE board_id = $1 AND cursor > $2
       ORDER BY cursor ASC`,
      [boardId, cursor],
    );
    return result.rows.map((row) => ({ cursor: Number(row.cursor), operation: row.operation }));
  }

  async latestCursor(boardId: string): Promise<number> {
    const result = await this.pool.query<{ cursor: string }>(
      "SELECT COALESCE(MAX(cursor), 0)::text AS cursor FROM board_operations WHERE board_id = $1",
      [boardId],
    );
    return Number(result.rows[0]?.cursor ?? 0);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
