import type { PoolClient } from 'pg';

export const name = '003_add_nudges';

/**
 * Tracks which matches have been nudged so we never send
 * more than one follow-up reminder per match.
 */
export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS nudges (
      id         SERIAL PRIMARY KEY,
      match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (match_id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_nudges_match_id
      ON nudges (match_id);
  `);
}
