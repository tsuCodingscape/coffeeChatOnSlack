/**
 * Run with: npm run db:migrate
 *
 * Creates all tables needed for the MVP.
 * Safe to re-run — uses IF NOT EXISTS throughout.
 */

import 'dotenv/config';
import { db } from './pool';

async function migrate(): Promise<void> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // ------------------------------------------------------------------
    // workspaces
    // One row per Slack workspace that has installed the bot.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id                  SERIAL PRIMARY KEY,
        slack_workspace_id  TEXT NOT NULL UNIQUE,
        bot_token           TEXT NOT NULL,        -- xoxb-... stored encrypted in prod
        installed_by        TEXT NOT NULL,        -- slack user id of installer
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ------------------------------------------------------------------
    // programs
    // Configuration for a workspace's coffee-chat program.
    // One program per workspace for MVP.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS programs (
        id                      SERIAL PRIMARY KEY,
        workspace_id            INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        channel_id              TEXT NOT NULL,     -- Slack channel ID e.g. C012AB3CD
        cadence                 TEXT NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly')),
        next_run_at             TIMESTAMPTZ,
        paused                  BOOLEAN NOT NULL DEFAULT FALSE,
        intro_message_template  TEXT NOT NULL DEFAULT '',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id)
      );
    `);

    // ------------------------------------------------------------------
    // participants
    // Tracks opt-in status for each user in each workspace.
    // Populated automatically when the bot sees channel_member events.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id              SERIAL PRIMARY KEY,
        workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        slack_user_id   TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'snoozed', 'opted_out')),
        snoozed_until   TIMESTAMPTZ,               -- null unless currently snoozed
        joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, slack_user_id)
      );
    `);

    // ------------------------------------------------------------------
    // match_rounds
    // One row per scheduled run of the matching job.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS match_rounds (
        id          SERIAL PRIMARY KEY,
        program_id  INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'failed')),
        error_log   TEXT
      );
    `);

    // ------------------------------------------------------------------
    // matches
    // Individual pairings within a round. participant_c is nullable for trios.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id                SERIAL PRIMARY KEY,
        match_round_id    INTEGER NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
        participant_a_id  INTEGER NOT NULL REFERENCES participants(id),
        participant_b_id  INTEGER NOT NULL REFERENCES participants(id),
        participant_c_id  INTEGER REFERENCES participants(id),  -- trio only
        slack_message_ts  TEXT,   -- timestamp of the sent DM (useful for threading)
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ------------------------------------------------------------------
    // feedback
    // Optional "did you meet?" check-in responses.
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id              SERIAL PRIMARY KEY,
        match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        participant_id  INTEGER NOT NULL REFERENCES participants(id),
        did_meet        BOOLEAN,
        rating          SMALLINT CHECK (rating BETWEEN 1 AND 5),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (match_id, participant_id)
      );
    `);

    // ------------------------------------------------------------------
    // Indexes for hot query paths
    // ------------------------------------------------------------------
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_participants_workspace_status
        ON participants (workspace_id, status);

      CREATE INDEX IF NOT EXISTS idx_matches_round
        ON matches (match_round_id);

      -- Used by repeat-prevention: find recent matches for a participant
      CREATE INDEX IF NOT EXISTS idx_matches_participant_a
        ON matches (participant_a_id);
      CREATE INDEX IF NOT EXISTS idx_matches_participant_b
        ON matches (participant_b_id);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete');
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
