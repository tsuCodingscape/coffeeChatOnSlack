import type { CallbackOptions } from '@slack/oauth';

/**
 * Bot token scopes requested during the OAuth install flow.
 * Keep in sync with the "OAuth & Permissions" scopes configured
 * on the Slack app (see README).
 */
export const OAUTH_SCOPES: string[] = [
  'channels:read',
  'groups:read',
  'chat:write',
  'im:write',
  'users:read',
  'commands',
];

/**
 * Customizes the pages shown at the end of the OAuth redirect
 * (GET /slack/oauth_redirect). Installation itself is persisted by
 * postgresInstallationStore (src/db/installations.ts) before these run.
 */
export const OAUTH_CALLBACK_OPTIONS: CallbackOptions = {
  success: (_installation, _options, _req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      `<html><body style="font-family: sans-serif; text-align: center; padding-top: 10%;">` +
        `<h2>☕ Coffee Roulette installed!</h2>` +
        `<p>Head back to Slack and run <code>/coffee-admin setup</code> to choose a channel and cadence.</p>` +
        `</body></html>`
    );
  },
  failure: (error, _options, _req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(
      `<html><body style="font-family: sans-serif; text-align: center; padding-top: 10%;">` +
        `<h2>⚠️ Installation failed</h2>` +
        `<p>${error.message || 'Something went wrong. Please try again.'}</p>` +
        `</body></html>`
    );
  },
};
