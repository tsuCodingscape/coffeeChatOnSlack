import { runMatchingJob } from './matcher';
import { runNudgeJob } from './nudge';
import { db } from '../db/pool';

/**
 * Scheduler — two jobs:
 *
 * 1. Matching job  — polls every 60 seconds for programs due to run
 * 2. Nudge job     — runs once daily to follow up on unconfirmed matches
 */
export function startScheduler(): void {
  console.log('⏰ Scheduler started — checking every 60 seconds');

  // ── Matching job — runs every 60 seconds ───────────────────────────────────
  setInterval(async () => {
    try {
      await checkAndRunDuePrograms();
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  }, 60_000);

  // ── Nudge job — runs once every 24 hours ──────────────────────────────────
  setInterval(async () => {
    try {
      await runNudgeJob();
    } catch (err) {
      console.error('Nudge scheduler error:', err);
    }
  }, 24 * 60 * 60 * 1000);

  // Run both once on startup after a short delay
  // to let the Slack connection stabilize first
  setTimeout(() => {
    checkAndRunDuePrograms().catch(console.error);
    runNudgeJob().catch(console.error);
  }, 5000);
}

async function checkAndRunDuePrograms(): Promise<void> {
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

    await runMatchingJob(program, workspace);
  }
}