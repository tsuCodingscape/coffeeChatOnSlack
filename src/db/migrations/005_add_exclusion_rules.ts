import type { PoolClient } from 'pg';

export const name = '005_add_exclusion_rules';

/**
 * Stores team/group names per participant. Participants on the
 * same team are avoided as matches by the pairing algorithm.
 */
export async function up(client: PoolClient): Promise<void> {
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
}
