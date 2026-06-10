import { db } from './pool';

export interface Workspace {
  id: number;
  slack_workspace_id: string;
  bot_token: string;
  installed_by: string;
  created_at: Date;
}

export interface Program {
  id: number;
  workspace_id: number;
  channel_id: string;
  cadence: 'weekly' | 'biweekly' | 'monthly';
  next_run_at: Date | null;
  paused: boolean;
  intro_message_template: string;
  created_at: Date;
}

export async function findWorkspaceBySlackId(
  slackWorkspaceId: string
): Promise<Workspace | null> {
  const { rows } = await db.query<Workspace>(
    `SELECT * FROM workspaces WHERE slack_workspace_id = $1`,
    [slackWorkspaceId]
  );
  return rows[0] ?? null;
}

export async function getProgramForWorkspace(
  workspaceId: number
): Promise<Program | null> {
  const { rows } = await db.query<Program>(
    `SELECT * FROM programs WHERE workspace_id = $1`,
    [workspaceId]
  );
  return rows[0] ?? null;
}
