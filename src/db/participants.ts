import { db } from './pool';

export type ParticipantStatus = 'active' | 'snoozed' | 'opted_out';

export interface Participant {
  id: number;
  workspace_id: number;
  slack_user_id: string;
  status: ParticipantStatus;
  snoozed_until: Date | null;
  priority: boolean;
  zoom_link: string | null;
  timezone: string | null;
  joined_at: Date;
  updated_at: Date;
}

export async function upsertParticipant(
  workspaceId: number,
  slackUserId: string
): Promise<Participant> {
  const { rows } = await db.query<Participant>(
    `
    INSERT INTO participants (workspace_id, slack_user_id, status, updated_at)
    VALUES ($1, $2, 'active', NOW())
    ON CONFLICT (workspace_id, slack_user_id)
    DO UPDATE SET
      status     = CASE WHEN participants.status = 'opted_out' THEN 'active' ELSE participants.status END,
      updated_at = NOW()
    RETURNING *
    `,
    [workspaceId, slackUserId]
  );
  return rows[0];
}

export async function optOutParticipant(
  workspaceId: number,
  slackUserId: string
): Promise<void> {
  await db.query(
    `UPDATE participants
     SET status = 'opted_out', priority = FALSE, updated_at = NOW()
     WHERE workspace_id = $1 AND slack_user_id = $2`,
    [workspaceId, slackUserId]
  );
}

export async function snoozeParticipant(
  workspaceId: number,
  slackUserId: string,
  snoozedUntil: Date
): Promise<void> {
  await db.query(
    `UPDATE participants
     SET status = 'snoozed', snoozed_until = $3, updated_at = NOW()
     WHERE workspace_id = $1 AND slack_user_id = $2`,
    [workspaceId, slackUserId, snoozedUntil]
  );
}

export async function autoSnoozeOddParticipant(
  workspaceId: number,
  slackUserId: string,
  snoozedUntil: Date
): Promise<void> {
  await db.query(
    `UPDATE participants
     SET status = 'snoozed', snoozed_until = $3, priority = TRUE, updated_at = NOW()
     WHERE workspace_id = $1 AND slack_user_id = $2`,
    [workspaceId, slackUserId, snoozedUntil]
  );
}

export async function expireSnoozedParticipants(workspaceId: number): Promise<void> {
  await db.query(
    `UPDATE participants
     SET status = 'active', snoozed_until = NULL, updated_at = NOW()
     WHERE workspace_id = $1
       AND status = 'snoozed'
       AND snoozed_until <= NOW()`,
    [workspaceId]
  );
}

export async function getActiveParticipants(workspaceId: number): Promise<Participant[]> {
  const { rows } = await db.query<Participant>(
    `SELECT * FROM participants
     WHERE workspace_id = $1 AND status = 'active'
     ORDER BY priority DESC, joined_at ASC`,
    [workspaceId]
  );
  return rows;
}

export async function clearPriority(participantId: number): Promise<void> {
  await db.query(
    `UPDATE participants SET priority = FALSE, updated_at = NOW() WHERE id = $1`,
    [participantId]
  );
}

export async function saveZoomLink(
  workspaceId: number,
  slackUserId: string,
  zoomLink: string
): Promise<void> {
  await db.query(
    `UPDATE participants
     SET zoom_link = $3, updated_at = NOW()
     WHERE workspace_id = $1 AND slack_user_id = $2`,
    [workspaceId, slackUserId, zoomLink]
  );
}

/**
 * Save a user's IANA timezone string.
 * e.g. "America/Los_Angeles", "America/New_York"
 */
export async function saveTimezone(
  workspaceId: number,
  slackUserId: string,
  timezone: string
): Promise<void> {
  await db.query(
    `UPDATE participants
     SET timezone = $3, updated_at = NOW()
     WHERE workspace_id = $1 AND slack_user_id = $2`,
    [workspaceId, slackUserId, timezone]
  );
}

export async function findParticipant(
  workspaceId: number,
  slackUserId: string
): Promise<Participant | null> {
  const { rows } = await db.query<Participant>(
    `SELECT * FROM participants WHERE workspace_id = $1 AND slack_user_id = $2`,
    [workspaceId, slackUserId]
  );
  return rows[0] ?? null;
}