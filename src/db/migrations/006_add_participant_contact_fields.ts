import type { PoolClient } from 'pg';

export const name = '006_add_participant_contact_fields';

/**
 * Adds zoom_link and timezone to participants.
 *
 * These columns back src/db/participants.ts (saveZoomLink, saveTimezone)
 * and were previously only applied by hand against the production DB —
 * committing them here so a fresh database ends up with the same schema.
 */
export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE participants
    ADD COLUMN IF NOT EXISTS zoom_link TEXT,
    ADD COLUMN IF NOT EXISTS timezone TEXT;
  `);
}
