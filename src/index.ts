import 'dotenv/config';
import { App, ExpressReceiver } from '@slack/bolt';
import { connectDB } from './db/pool';
import { registerOptInHandlers } from './handlers/optIn';
import { registerSlashCommands } from './handlers/commands';
import { registerAdminHandlers } from './handlers/admin';
import { registerFeedbackHandlers } from './handlers/feedback';
import { startScheduler } from './jobs/scheduler';

const isProduction = process.env.NODE_ENV === 'production';

async function main(): Promise<void> {
  // 1. Verify DB connection before accepting any traffic
  await connectDB();

  let app: App;

  if (isProduction) {
    // ── Production: HTTP mode with ExpressReceiver ──────────────────────────
    // Render provides a public HTTPS URL so Slack can send events via HTTP
    const receiver = new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      endpoints: '/slack/events',
    });

    app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      receiver,
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