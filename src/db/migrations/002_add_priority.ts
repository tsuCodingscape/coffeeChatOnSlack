import type { PoolClient } from 'pg';

export const name = '002_add_priority';

/**
 * Adds a priority column to participants — used to requeue the
 * odd-person-out from a round so they're matched first next time.
 */
export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE participants
    ADD COLUMN IF NOT EXISTS priority BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_participants_priority
      ON participants (workspace_id, priority)
      WHERE priority = TRUE;
  `);
}
