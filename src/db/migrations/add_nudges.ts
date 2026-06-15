/**
 * Migration: add nudges table
 * Run with: npx ts-node src/db/migrations/add_nudges.ts
 */

import 'dotenv/config';
import { db } from '../pool';

async function migrate(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Tracks which matches have been nudged
    // so we never send more than one nudge per match
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

    await client.query('COMMIT');
    console.log('✅ Migration complete: added nudges table');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

migrate();