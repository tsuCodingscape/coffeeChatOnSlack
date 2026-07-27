import type { PoolClient } from 'pg';

export const name = '004_add_icebreaker_feedback';

/**
 * Stores thumbs up/down ratings for each icebreaker question,
 * used to weight which questions get picked more often.
 */
export async function up(client: PoolClient): Promise<void> {
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
}
