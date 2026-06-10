import 'dotenv/config';
import { App } from '@slack/bolt';
import { connectDB } from './db/pool';
import { registerOptInHandlers } from './handlers/optIn';
import { registerSlashCommands } from './handlers/commands';
import { registerAdminHandlers } from './handlers/admin';
import { registerFeedbackHandlers } from './handlers/feedback';
import { startScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  await connectDB();

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: process.env.NODE_ENV === 'development',
    appToken: process.env.SLACK_APP_TOKEN,
    port: Number(process.env.PORT ?? 3000),
  });

  // All register calls must be inside main() where app is defined
  registerOptInHandlers(app);
  registerSlashCommands(app);
  registerAdminHandlers(app);
  registerFeedbackHandlers(app);  // ← inside main()

  startScheduler();

  await app.start();
  console.log(`⚡ Coffee Roulette is running (${process.env.NODE_ENV ?? 'production'})`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});