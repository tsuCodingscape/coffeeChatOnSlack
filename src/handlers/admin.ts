import { App } from '@slack/bolt';
import type { View } from '@slack/types';
import { db } from '../db/pool';
import { findWorkspaceBySlackId, getProgramForWorkspace } from '../db/workspaces';
import { getNextRunDate } from '../utils/schedule';

/**
 * Admin commands, all under /coffee-admin to keep them separate from
 * user-facing /coffee commands.
 *
 * /coffee-admin setup    — interactive setup flow (channel + cadence)
 * /coffee-admin pause    — pause matching without deleting config
 * /coffee-admin resume   — resume a paused program
 * /coffee-admin status   — show current program config
 * /coffee-admin report   — show basic participation stats
 */
export function registerAdminHandlers(app: App): void {

  app.command('/coffee-admin', async ({ command, ack, respond, context, logger, client }) => {
    await ack();

    const subcommand = command.text.trim().toLowerCase().split(/\s+/)[0];
    const args = command.text.trim().split(/\s+/).slice(1);

    try {
      const workspace = await findWorkspaceBySlackId(context.teamId!);
      if (!workspace) {
        await respond('⚠️ Coffee Roulette isn\'t installed in this workspace yet.');
        return;
      }

      switch (subcommand) {

        // ── /coffee-admin setup ──────────────────────────────────────────────
        // Opens a modal so the admin can configure channel + cadence
        case 'setup': {
          await client.views.open({
            trigger_id: command.trigger_id,
            view: buildSetupModal(workspace.id),
          });
          break;
        }

        // ── /coffee-admin pause ──────────────────────────────────────────────
        case 'pause': {
          const program = await getProgramForWorkspace(workspace.id);
          if (!program) {
            await respond('No program configured yet. Run `/coffee-admin setup` first.');
            return;
          }
          if (program.paused) {
            await respond('The program is already paused. Use `/coffee-admin resume` to restart it.');
            return;
          }
          await db.query(`UPDATE programs SET paused = TRUE WHERE id = $1`, [program.id]);
          await respond('⏸ Matching has been paused. No intros will be sent until you resume. Use `/coffee-admin resume` to restart.');
          break;
        }

        // ── /coffee-admin resume ─────────────────────────────────────────────
        case 'resume': {
          const program = await getProgramForWorkspace(workspace.id);
          if (!program) {
            await respond('No program configured yet. Run `/coffee-admin setup` first.');
            return;
          }
          if (!program.paused) {
            await respond('The program is already running.');
            return;
          }
          const nextRun = getNextRunDate(new Date(), program.cadence);
          await db.query(
            `UPDATE programs SET paused = FALSE, next_run_at = $1 WHERE id = $2`,
            [nextRun, program.id]
          );
          await respond(
            `▶️ Matching resumed! Next round scheduled for <!date^${Math.floor(nextRun.getTime() / 1000)}^{date_pretty}|${nextRun.toDateString()}>.`
          );
          break;
        }

        // ── /coffee-admin status ─────────────────────────────────────────────
        case 'status': {
          const program = await getProgramForWorkspace(workspace.id);
          if (!program) {
            await respond('No program configured yet. Run `/coffee-admin setup` first.');
            return;
          }

          const { rows } = await db.query(
            `SELECT COUNT(*) AS count FROM participants
             WHERE workspace_id = $1 AND status = 'active'`,
            [workspace.id]
          );

          const nextRun = program.next_run_at
            ? `<!date^${Math.floor(program.next_run_at.getTime() / 1000)}^{date_pretty}|${program.next_run_at.toDateString()}>`
            : '_not scheduled_';

          await respond(
            `*☕ Coffee Roulette — Program Status*\n\n` +
            `• *Channel:* <#${program.channel_id}>\n` +
            `• *Cadence:* ${program.cadence}\n` +
            `• *Status:* ${program.paused ? '⏸ paused' : '▶️ active'}\n` +
            `• *Next run:* ${nextRun}\n` +
            `• *Active participants:* ${rows[0].count}`
          );
          break;
        }

        // ── /coffee-admin report ─────────────────────────────────────────────
        case 'report': {
          const program = await getProgramForWorkspace(workspace.id);
          if (!program) {
            await respond('No program configured yet. Run `/coffee-admin setup` first.');
            return;
          }

          const stats = await getReportStats(workspace.id, program.id);
          await respond(buildReportText(stats));
          break;
        }

        default: {
          await respond(
            '*Coffee Roulette admin commands:*\n' +
            '• `/coffee-admin setup` — configure channel, cadence, and intro message\n' +
            '• `/coffee-admin pause` — pause matching\n' +
            '• `/coffee-admin resume` — resume matching\n' +
            '• `/coffee-admin status` — view current config and participant count\n' +
            '• `/coffee-admin report` — view usage stats'
          );
        }
      }
    } catch (err) {
      logger.error('Error in /coffee-admin:', err);
      await respond('Something went wrong. Please try again in a moment.');
    }
  });

  // ── Modal submission handler ────────────────────────────────────────────────
  app.view('coffee_setup_modal', async ({ ack, body, view, context, logger }) => {
    await ack();

    try {
      const values = view.state.values;
      const channelId: string  = values.channel_block.channel_select.selected_channel!;
      const cadence             = values.cadence_block.cadence_select.selected_option!.value as
                                    'weekly' | 'biweekly' | 'monthly';
      const introMessage: string = values.message_block.intro_message.value ?? '';

      const workspace = await findWorkspaceBySlackId(context.teamId!);
      if (!workspace) return;

      const nextRun = getNextRunDate(new Date(), cadence);

      // Upsert the program — update if one already exists
      await db.query(
        `
        INSERT INTO programs
          (workspace_id, channel_id, cadence, next_run_at, intro_message_template, paused)
        VALUES ($1, $2, $3, $4, $5, FALSE)
        ON CONFLICT (workspace_id)
        DO UPDATE SET
          channel_id              = EXCLUDED.channel_id,
          cadence                 = EXCLUDED.cadence,
          next_run_at             = EXCLUDED.next_run_at,
          intro_message_template  = EXCLUDED.intro_message_template,
          paused                  = FALSE
        `,
        [workspace.id, channelId, cadence, nextRun, introMessage]
      );

      // Post a welcome message in the configured channel
      await app.client.chat.postMessage({
        token: workspace.bot_token,
        channel: channelId,
        text: `☕ *Coffee Roulette is live!*\nJoin this channel to be included in automatic coffee chat matchings. First round starts <!date^${Math.floor(nextRun.getTime() / 1000)}^{date_pretty}|${nextRun.toDateString()}>. Use \`/coffee status\` to see your current status.`,
      });

      logger.info(`Program configured for workspace ${workspace.slack_workspace_id}, channel ${channelId}, cadence ${cadence}`);

    } catch (err) {
      logger.error('Error saving setup modal:', err);
    }
  });
}

// ─── Modal builder ────────────────────────────────────────────────────────────

function buildSetupModal(workspaceId: number): View {
  return {
    type: 'modal',
    callback_id: 'coffee_setup_modal',
    title: { type: 'plain_text', text: 'Set up Coffee Roulette' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Configure the channel and schedule for automatic coffee chat introductions.',
        },
      },
      {
        type: 'input',
        block_id: 'channel_block',
        label: { type: 'plain_text', text: 'Coffee chat channel' },
        hint: {
          type: 'plain_text',
          text: 'Members of this channel will be included in the matching pool.',
        },
        element: {
          type: 'channels_select',
          action_id: 'channel_select',
          placeholder: { type: 'plain_text', text: 'Select a channel' },
        },
      },
      {
        type: 'input',
        block_id: 'cadence_block',
        label: { type: 'plain_text', text: 'Matching cadence' },
        element: {
          type: 'static_select',
          action_id: 'cadence_select',
          placeholder: { type: 'plain_text', text: 'How often should matches run?' },
          options: [
            { text: { type: 'plain_text', text: 'Weekly' },   value: 'weekly' },
            { text: { type: 'plain_text', text: 'Biweekly' }, value: 'biweekly' },
            { text: { type: 'plain_text', text: 'Monthly' },  value: 'monthly' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'message_block',
        optional: true,
        label: { type: 'plain_text', text: 'Custom intro message (optional)' },
        hint: {
          type: 'plain_text',
          text: 'Use {mentions} for the people\'s names and {icebreaker} for the conversation starter. Leave blank to use the default.',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'intro_message',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: '{mentions} — time for a coffee chat! ☕\n\n{icebreaker}',
          },
        },
      },
    ],
  };
}

// ─── Report helpers ───────────────────────────────────────────────────────────

interface ReportStats {
  totalParticipants: number;
  activeParticipants: number;
  snoozedParticipants: number;
  optedOut: number;
  totalRounds: number;
  totalIntrosSent: number;
}

async function getReportStats(workspaceId: number, programId: number): Promise<ReportStats> {
  const { rows: participantRows } = await db.query(
    `SELECT status, COUNT(*) AS count
     FROM participants WHERE workspace_id = $1
     GROUP BY status`,
    [workspaceId]
  );

  const countByStatus: Record<string, number> = {};
  for (const row of participantRows) {
    countByStatus[row.status] = parseInt(row.count, 10);
  }

  const { rows: roundRows } = await db.query(
    `SELECT COUNT(*) AS count FROM match_rounds
     WHERE program_id = $1 AND status = 'completed'`,
    [programId]
  );

  const { rows: matchRows } = await db.query(
    `SELECT COUNT(*) AS count FROM matches m
     JOIN match_rounds mr ON mr.id = m.match_round_id
     WHERE mr.program_id = $1 AND mr.status = 'completed'`,
    [programId]
  );

  return {
    totalParticipants: Object.values(countByStatus).reduce((a, b) => a + b, 0),
    activeParticipants: countByStatus['active'] ?? 0,
    snoozedParticipants: countByStatus['snoozed'] ?? 0,
    optedOut: countByStatus['opted_out'] ?? 0,
    totalRounds: parseInt(roundRows[0].count, 10),
    totalIntrosSent: parseInt(matchRows[0].count, 10),
  };
}

function buildReportText(stats: ReportStats): string {
  return (
    `*☕ Coffee Roulette — Usage Report*\n\n` +
    `*Participants*\n` +
    `• Total ever enrolled: ${stats.totalParticipants}\n` +
    `• Currently active: ${stats.activeParticipants}\n` +
    `• Currently snoozed: ${stats.snoozedParticipants}\n` +
    `• Opted out: ${stats.optedOut}\n\n` +
    `*Matching*\n` +
    `• Rounds completed: ${stats.totalRounds}\n` +
    `• Total intros sent: ${stats.totalIntrosSent}\n` +
    `• Avg matches per round: ${stats.totalRounds > 0 ? (stats.totalIntrosSent / stats.totalRounds).toFixed(1) : '—'}`
  );
}