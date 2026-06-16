/**
 * Migration: add exclusion_rules table
 * Run in Render Shell as SQL directly.
 */

import 'dotenv/config';
import { db } from '../pool';

async function migrate(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Stores team/group names per participant
    // Participants on the same team won't be matched together
    await client.query(`
      CREATE TABLE IF NOT EXISTS participant_teams (
        id              SERIAL PRIMARY KEY,
        participant_id  INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        team_name       TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (participant_id, team_name)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_participant_teams_participant
        ON participant_teams (participant_id);
      CREATE INDEX IF NOT EXISTS idx_participant_teams_team
        ON participant_teams (team_name);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete: added participant_teams table');
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