/**
 * Migration: add priority column to participants
 * Run with: npx ts-node src/db/migrations/add_priority.ts
 */

import 'dotenv/config';
import { db } from '../pool';

async function migrate(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE participants
      ADD COLUMN IF NOT EXISTS priority BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_participants_priority
        ON participants (workspace_id, priority)
        WHERE priority = TRUE;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete: added priority column to participants');
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