import 'dotenv/config';
import { App, ExpressReceiver } from '@slack/bolt';
import { connectDB } from './db/pool';
import { registerOptInHandlers } from './handlers/optIn';
import { registerSlashCommands } from './handlers/commands';
import { registerAdminHandlers } from './handlers/admin';
import { registerFeedbackHandlers } from './handlers/feedback';
import { OAUTH_SCOPES, OAUTH_CALLBACK_OPTIONS } from './handlers/install';
import { postgresInstallationStore } from './db/installations';
import { startScheduler } from './jobs/scheduler';

const isProduction = process.env.NODE_ENV === 'production';

async function main(): Promise<void> {
  // 1. Verify DB connection before accepting any traffic
  await connectDB();

  let app: App;

  if (isProduction) {
    const receiver = new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      endpoints: '/slack/events',
      processBeforeResponse: true,
      clientId: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
      stateSecret: process.env.SLACK_STATE_SECRET!,
      scopes: OAUTH_SCOPES,
      installationStore: postgresInstallationStore,
      installerOptions: {
        callbackOptions: OAUTH_CALLBACK_OPTIONS,
      },
    });

    // No static `token` here — the OAuth installer's authorize() resolves
    // each incoming request's bot token from postgresInstallationStore,
    // which is what lets one deployment serve many Slack workspaces.
    app = new App({
      receiver,
      processBeforeResponse: true,
    });

    // Register all handlers
    registerOptInHandlers(app);
    registerSlashCommands(app);
    registerAdminHandlers(app);
    registerFeedbackHandlers(app);

    // Start the matching scheduler
    startScheduler();

    // Start HTTP server
    await app.start(Number(process.env.PORT ?? 3000));
    console.log(`⚡ Coffee Roulette is running in HTTP mode on port ${process.env.PORT ?? 3000}`);

  } else {
    // ── Development: Socket Mode (no public URL needed) ─────────────────────
    app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: process.env.SLACK_APP_TOKEN,
      port: Number(process.env.PORT ?? 3000),
    });

    // Register all handlers
    registerOptInHandlers(app);
    registerSlashCommands(app);
    registerAdminHandlers(app);
    registerFeedbackHandlers(app);

    // Start the matching scheduler
    startScheduler();

    await app.start();
    console.log(`⚡ Coffee Roulette is running in Socket Mode (development)`);
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});