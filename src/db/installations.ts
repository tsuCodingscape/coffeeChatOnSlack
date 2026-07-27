import type { Installation, InstallationQuery, InstallationStore } from '@slack/bolt';
import { db } from './pool';

/**
 * Persists Slack OAuth installations to the workspaces table so a single
 * deployment can serve any number of Slack workspaces. Bolt calls
 * storeInstallation() once per install/reinstall and fetchInstallation()
 * on every incoming request to resolve that workspace's bot token.
 */
export const postgresInstallationStore: InstallationStore = {
  async storeInstallation(installation: Installation): Promise<void> {
    if (installation.isEnterpriseInstall || !installation.team?.id) {
      throw new Error('Coffee Roulette only supports single-workspace installs, not Enterprise Grid.');
    }
    if (!installation.bot?.token) {
      throw new Error('OAuth installation is missing a bot token.');
    }

    await db.query(
      `
      INSERT INTO workspaces (slack_workspace_id, bot_token, installed_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (slack_workspace_id)
      DO UPDATE SET
        bot_token    = EXCLUDED.bot_token,
        installed_by = EXCLUDED.installed_by
      `,
      [installation.team.id, installation.bot.token, installation.user.id]
    );
  },

  async fetchInstallation(query: InstallationQuery<boolean>): Promise<Installation> {
    if (query.isEnterpriseInstall || !query.teamId) {
      throw new Error('Coffee Roulette only supports single-workspace installs, not Enterprise Grid.');
    }

    const { rows } = await db.query<{
      slack_workspace_id: string;
      bot_token: string;
      installed_by: string;
    }>(
      `SELECT slack_workspace_id, bot_token, installed_by FROM workspaces WHERE slack_workspace_id = $1`,
      [query.teamId]
    );

    if (rows.length === 0) {
      throw new Error(`No installation found for workspace ${query.teamId}`);
    }

    const row = rows[0];

    return {
      team: { id: row.slack_workspace_id },
      enterprise: undefined,
      user: { id: row.installed_by, token: undefined, scopes: undefined },
      bot: {
        token: row.bot_token,
        id: '',
        userId: '',
        scopes: [],
      },
    };
  },

  // No deleteInstallation: uninstalling the Slack app shouldn't wipe out
  // match/feedback history. If the bot token is later revoked, calls using
  // it will simply start failing rather than silently deleting data.
};
