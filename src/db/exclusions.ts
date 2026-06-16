import { db } from './pool';

/**
 * Fetches a map of participant_id → team_name for all active participants.
 * Used by the matching algorithm to avoid same-team pairs.
 */
export async function getParticipantTeams(
  workspaceId: number
): Promise<Map<number, string>> {
  const { rows } = await db.query<{ participant_id: number; team_name: string }>(
    `
    SELECT pt.participant_id, pt.team_name
    FROM participant_teams pt
    JOIN participants p ON p.id = pt.participant_id
    WHERE p.workspace_id = $1 AND p.status = 'active'
    `,
    [workspaceId]
  );

  const teamMap = new Map<number, string>();
  for (const row of rows) {
    teamMap.set(row.participant_id, row.team_name);
  }
  return teamMap;
}

/**
 * Set or update a participant's team.
 */
export async function setParticipantTeam(
  participantId: number,
  teamName: string
): Promise<void> {
  await db.query(
    `
    INSERT INTO participant_teams (participant_id, team_name)
    VALUES ($1, $2)
    ON CONFLICT (participant_id, team_name)
    DO NOTHING
    `,
    [participantId, teamName]
  );
}

/**
 * Remove a participant's team assignment.
 */
export async function removeParticipantTeam(
  participantId: number
): Promise<void> {
  await db.query(
    `DELETE FROM participant_teams WHERE participant_id = $1`,
    [participantId]
  );
}

/**
 * Get all teams in a workspace with their member counts.
 * Used by admin report.
 */
export async function getTeamSummary(
  workspaceId: number
): Promise<Array<{ team_name: string; member_count: number }>> {
  const { rows } = await db.query<{ team_name: string; member_count: number }>(
    `
    SELECT pt.team_name, COUNT(*) AS member_count
    FROM participant_teams pt
    JOIN participants p ON p.id = pt.participant_id
    WHERE p.workspace_id = $1
    GROUP BY pt.team_name
    ORDER BY member_count DESC
    `,
    [workspaceId]
  );
  return rows;
}