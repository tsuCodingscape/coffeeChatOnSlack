import type { WebClient } from '@slack/web-api';

/**
 * True if the given Slack user is a workspace admin, owner, or primary owner.
 * Used to gate /coffee-admin — without this, any workspace member could
 * pause matching, reconfigure the program, or reassign team exclusions.
 */
export async function isWorkspaceAdmin(client: WebClient, userId: string): Promise<boolean> {
  try {
    const { user } = await client.users.info({ user: userId });
    return Boolean(user?.is_admin || user?.is_owner || user?.is_primary_owner);
  } catch {
    return false;
  }
}
