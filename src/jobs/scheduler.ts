import { runMatchingJob } from './matcher';
import { db } from '../db/pool';

/**
 * Polls the database every minute for programs whose next_run_at has passed.
 *
 * This is intentionally simple for the MVP — no external queue or cron daemon
 * needed. For larger scale, replace with a proper job queue (e.g. pg-boss,
 * BullMQ) or a cloud scheduler (AWS EventBridge, Railway cron, etc.).
 */
export function startScheduler(): void {
  console.log('⏰ Scheduler started — checking every 60 seconds');

  setInterval(async () => {
    try {
      await checkAndRunDuePrograms();
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  }, 60_000);

  // Also run once immediately on startup to catch any missed runs
  setTimeout(() => {
    checkAndRunDuePrograms().catch(console.error);
  }, 5000); // wait 5s for Socket Mode connection to stabilize
}

async function checkAndRunDuePrograms(): Promise<void> {
  // Fetch all programs that are due and not paused
  // The FOR UPDATE SKIP LOCKED ensures that if multiple app instances are
  // running (e.g. after a deploy), only one picks up each program.
  const { rows } = await db.query(
    `
    SELECT
      p.id              AS program_id,
      p.workspace_id,
      p.channel_id,
      p.cadence,
      p.next_run_at,
      p.paused,
      p.intro_message_template,
      w.id              AS w_id,
      w.slack_workspace_id,
      w.bot_token
    FROM programs p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.paused = FALSE
      AND p.next_run_at IS NOT NULL
      AND p.next_run_at <= NOW()
    FOR UPDATE OF p SKIP LOCKED
    `
  );

  if (rows.length === 0) return;

  console.log(`🔍 Found ${rows.length} program(s) due for matching`);

  for (const row of rows) {
    const program = {
      id:                     row.program_id,
      workspace_id:           row.workspace_id,
      channel_id:             row.channel_id,
      cadence:                row.cadence,
      next_run_at:            row.next_run_at,
      paused:                 row.paused,
      intro_message_template: row.intro_message_template,
    };

    const workspace = {
      id:                   row.w_id,
      slack_workspace_id:   row.slack_workspace_id,
      bot_token:            row.bot_token,
    };

    // Run each program sequentially to avoid hammering Slack rate limits
    await runMatchingJob(program, workspace);
  }
}
