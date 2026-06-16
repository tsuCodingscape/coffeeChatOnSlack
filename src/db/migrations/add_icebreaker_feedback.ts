/**
 * Migration: add icebreaker_feedback table
 * Run in Render Shell:
 * node -e "require('./dist/db/migrations/add_icebreaker_feedback')"
 */

import 'dotenv/config';
import { db } from '../pool';

async function migrate(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Stores thumbs up/down ratings for each icebreaker question
    await client.query(`
      CREATE TABLE IF NOT EXISTS icebreaker_feedback (
        id              SERIAL PRIMARY KEY,
        question        TEXT NOT NULL,
        participant_id  INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        rating          TEXT NOT NULL CHECK (rating IN ('up', 'down')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (question, participant_id, match_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_icebreaker_feedback_question
        ON icebreaker_feedback (question);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete: added icebreaker_feedback table');
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