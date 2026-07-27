import { App } from '@slack/bolt';
import type { View } from '@slack/types';
import { db } from '../db/pool';
import { findWorkspaceBySlackId, getProgramForWorkspace } from '../db/workspaces';
import { getNextRunDate } from '../utils/schedule';
import { getIcebreakerStats } from '../utils/icebreakers_weighted';
import { getTeamSummary, setParticipantTeam, removeParticipantTeam } from '../db/exclusions';
import { isWorkspaceAdmin } from '../utils/authorization';

export function registerAdminHandlers(app: App): void {

  app.command('/coffee-admin', async ({ command, ack, respond, context, logger, client }) => {
    await ack();

    const subcommand = command.text.trim().toLowerCase().split(/\s+/)[0];

    try {
      const workspace = await findWorkspaceBySlackId(context.teamId!);
      if (!workspace) {
        await respond('⚠️ Coffee Roulette isn\'t installed in this workspace yet.');
        return;
      }

      if (!(await isWorkspaceAdmin(client, command.user_id))) {
        await respond('🚫 Only workspace admins/owners can use `/coffee-admin`.');
        return;
      }

      switch (subcommand) {

        // ── /coffee-admin setup ──────────────────────────────────────────────
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
          await respond('⏸ Matching has been paused. Use `/coffee-admin resume` to restart.');
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

        // ── /coffee-admin team ───────────────────────────────────────────────
        // Assign a team to a user: /coffee-admin team @user TeamName
        // Remove a team:           /coffee-admin team @user remove
        case 'team': {
          await client.views.open({
            trigger_id: command.trigger_id,
            view: buildTeamModal(),
          });
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
            '• `/coffee-admin status` — view current config\n' +
            '• `/coffee-admin team` — assign team exclusion rules\n' +
            '• `/coffee-admin report` — view usage stats and trends'
          );
        }
      }
    } catch (err) {
      logger.error('Error in /coffee-admin:', err);
      await respond('Something went wrong. Please try again in a moment.');
    }
  });

  // ── Setup modal submission ──────────────────────────────────────────────────
  app.view('coffee_setup_modal', async ({ ack, body, view, context, logger, client }) => {
    await ack();

    setImmediate(async () => {
      try {
        const values = view.state.values;
        const channelId: string = values.channel_block.channel_select.selected_channel!;
        const cadence = values.cadence_block.cadence_select.selected_option!.value as
                          'weekly' | 'biweekly' | 'monthly';
        const introMessage: string = values.message_block.intro_message.value ?? '';

        const workspace = await findWorkspaceBySlackId(context.teamId!);
        if (!workspace) return;

        if (!(await isWorkspaceAdmin(client, body.user.id))) {
          logger.warn(`Rejected coffee_setup_modal submission from non-admin ${body.user.id}`);
          return;
        }

        const nextRun = getNextRunDate(new Date(), cadence);

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

        await app.client.chat.postMessage({
          token: workspace.bot_token,
          channel: channelId,
          text: `☕ *Coffee Roulette is live!*\nJoin this channel to be included in automatic coffee chat matchings. First round starts <!date^${Math.floor(nextRun.getTime() / 1000)}^{date_pretty}|${nextRun.toDateString()}>. Use \`/coffee status\` to see your current status.`,
        });

        logger.info(`Program configured for workspace ${workspace.slack_workspace_id}`);
      } catch (err) {
        logger.error('Error saving setup modal:', err);
      }
    });
  });

  // ── Team modal submission ───────────────────────────────────────────────────
  app.view('team_assignment_modal', async ({ ack, body, view, context, logger, client }) => {
    await ack();

    setImmediate(async () => {
      try {
        const values = view.state.values;
        const selectedUser = values.user_block.user_select.selected_user!;
        const teamName = values.team_block.team_input.value?.trim() ?? '';
        const action = values.action_block.action_select.selected_option?.value ?? 'assign';

        const workspace = await findWorkspaceBySlackId(context.teamId!);
        if (!workspace) return;

        if (!(await isWorkspaceAdmin(client, body.user.id))) {
          logger.warn(`Rejected team_assignment_modal submission from non-admin ${body.user.id}`);
          return;
        }

        // Find participant
        const { rows } = await db.query<{ id: number }>(
          `SELECT id FROM participants WHERE workspace_id = $1 AND slack_user_id = $2`,
          [workspace.id, selectedUser]
        );

        if (rows.length === 0) {
          logger.warn(`Team assignment: participant not found for ${selectedUser}`);
          return;
        }

        const participantId = rows[0].id;

        if (action === 'remove') {
          await removeParticipantTeam(participantId);
          logger.info(`Team removed for participant ${participantId}`);
        } else {
          if (!teamName) return;
          await setParticipantTeam(participantId, teamName);
          logger.info(`Team "${teamName}" assigned to participant ${participantId}`);
        }

      } catch (err) {
        logger.error('Error saving team assignment:', err);
      }
    });
  });
}

// ─── Modal builders ───────────────────────────────────────────────────────────

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
        hint: { type: 'plain_text', text: 'Members of this channel will be included in the matching pool.' },
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
        hint: { type: 'plain_text', text: 'Use {mentions} for names and {icebreaker} for the conversation starter.' },
        element: {
          type: 'plain_text_input',
          action_id: 'intro_message',
          multiline: true,
          placeholder: { type: 'plain_text', text: '{mentions} — time for a coffee chat! ☕\n\n{icebreaker}' },
        },
      },
    ],
  } as unknown as View;
}

function buildTeamModal(): View {
  return {
    type: 'modal',
    callback_id: 'team_assignment_modal',
    title: { type: 'plain_text', text: 'Team exclusion rules' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Assign a team to a participant so they won\'t be matched with teammates. People on the same team will be avoided as matches.',
        },
      },
      {
        type: 'input',
        block_id: 'user_block',
        label: { type: 'plain_text', text: 'Participant' },
        element: {
          type: 'users_select',
          action_id: 'user_select',
          placeholder: { type: 'plain_text', text: 'Select a participant' },
        },
      },
      {
        type: 'input',
        block_id: 'action_block',
        label: { type: 'plain_text', text: 'Action' },
        element: {
          type: 'static_select',
          action_id: 'action_select',
          options: [
            { text: { type: 'plain_text', text: 'Assign to team' }, value: 'assign' },
            { text: { type: 'plain_text', text: 'Remove team assignment' }, value: 'remove' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'team_block',
        optional: true,
        label: { type: 'plain_text', text: 'Team name' },
        hint: { type: 'plain_text', text: 'e.g. Engineering, Design, Sales. People on the same team won\'t be matched.' },
        element: {
          type: 'plain_text_input',
          action_id: 'team_input',
          placeholder: { type: 'plain_text', text: 'Engineering' },
        },
      },
    ],
  } as unknown as View;
}

// ─── Report ───────────────────────────────────────────────────────────────────

interface ReportStats {
  totalParticipants: number;
  activeParticipants: number;
  snoozedParticipants: number;
  optedOut: number;
  totalRounds: number;
  totalIntrosSent: number;
  totalMeetingsConfirmed: number;
  confirmationRate: number;
  mostActiveParticipants: Array<{ slack_user_id: string; met_count: number }>;
  roundTrend: Array<{ month: string; intros: number; confirmed: number }>;
  icebreakerStats: {
    top: Array<{ question: string; net_score: number }>;
    bottom: Array<{ question: string; net_score: number }>;
  };
  teamSummary: Array<{ team_name: string; member_count: number }>;
}

async function getReportStats(workspaceId: number, programId: number): Promise<ReportStats> {
  const { rows: participantRows } = await db.query(
    `SELECT status, COUNT(*) AS count FROM participants
     WHERE workspace_id = $1 GROUP BY status`,
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

  const { rows: metRows } = await db.query(
    `SELECT COUNT(DISTINCT match_id) AS count FROM feedback WHERE did_meet = TRUE`
  );

  // Most active participants — people who confirmed they met the most
  const { rows: activeRows } = await db.query<{ slack_user_id: string; met_count: number }>(
    `
    SELECT p.slack_user_id, COUNT(*) AS met_count
    FROM feedback f
    JOIN participants p ON p.id = f.participant_id
    WHERE p.workspace_id = $1 AND f.did_meet = TRUE
    GROUP BY p.slack_user_id
    ORDER BY met_count DESC
    LIMIT 5
    `,
    [workspaceId]
  );

  // Round trend — last 6 months of intros vs confirmations
  const { rows: trendRows } = await db.query<{
    month: string;
    intros: number;
    confirmed: number;
  }>(
    `
    SELECT
      TO_CHAR(mr.run_at, 'Mon YYYY') AS month,
      COUNT(m.id) AS intros,
      COUNT(f.id) AS confirmed
    FROM match_rounds mr
    JOIN matches m ON m.match_round_id = mr.id
    LEFT JOIN feedback f ON f.match_id = m.id AND f.did_meet = TRUE
    WHERE mr.program_id = $1
      AND mr.status = 'completed'
      AND mr.run_at >= NOW() - INTERVAL '6 months'
    GROUP BY TO_CHAR(mr.run_at, 'Mon YYYY'), DATE_TRUNC('month', mr.run_at)
    ORDER BY DATE_TRUNC('month', mr.run_at) ASC
    `,
    [programId]
  );

  const [icebreakerStats, teamSummary] = await Promise.all([
    getIcebreakerStats(),
    getTeamSummary(workspaceId),
  ]);

  const totalIntros = parseInt(matchRows[0].count, 10);
  const totalMet = parseInt(metRows[0].count, 10);

  return {
    totalParticipants: Object.values(countByStatus).reduce((a, b) => a + b, 0),
    activeParticipants: countByStatus['active'] ?? 0,
    snoozedParticipants: countByStatus['snoozed'] ?? 0,
    optedOut: countByStatus['opted_out'] ?? 0,
    totalRounds: parseInt(roundRows[0].count, 10),
    totalIntrosSent: totalIntros,
    totalMeetingsConfirmed: totalMet,
    confirmationRate: totalIntros > 0 ? Math.round((totalMet / totalIntros) * 100) : 0,
    mostActiveParticipants: activeRows,
    roundTrend: trendRows,
    icebreakerStats,
    teamSummary,
  };
}

function buildReportText(stats: ReportStats): string {
  let text =
    `*☕ Coffee Roulette — Usage Report*\n\n` +
    `*Participants*\n` +
    `• Total ever enrolled: ${stats.totalParticipants}\n` +
    `• Currently active: ${stats.activeParticipants}\n` +
    `• Currently snoozed: ${stats.snoozedParticipants}\n` +
    `• Opted out: ${stats.optedOut}\n\n` +
    `*Matching*\n` +
    `• Rounds completed: ${stats.totalRounds}\n` +
    `• Total intros sent: ${stats.totalIntrosSent}\n` +
    `• Meetings confirmed: ${stats.totalMeetingsConfirmed} _(${stats.confirmationRate}% confirmation rate)_\n` +
    `• Avg matches per round: ${stats.totalRounds > 0 ? (stats.totalIntrosSent / stats.totalRounds).toFixed(1) : '—'}`;

  // Round trend
  if (stats.roundTrend.length > 0) {
    text += `\n\n*📈 Match trend (last 6 months):*\n`;
    text += stats.roundTrend
      .map((r) => {
        const rate = r.intros > 0 ? Math.round((r.confirmed / r.intros) * 100) : 0;
        return `• ${r.month}: ${r.intros} intros, ${r.confirmed} confirmed _(${rate}%)_`;
      })
      .join('\n');
  }

  // Most active participants
  if (stats.mostActiveParticipants.length > 0) {
    text += `\n\n*🏆 Most engaged participants:*\n`;
    text += stats.mostActiveParticipants
      .map((p, i) => `${i + 1}. <@${p.slack_user_id}> — ${p.met_count} chats confirmed`)
      .join('\n');
  }

  // Team summary
  if (stats.teamSummary.length > 0) {
    text += `\n\n*👥 Teams configured (exclusion rules):*\n`;
    text += stats.teamSummary
      .map((t) => `• ${t.team_name}: ${t.member_count} member(s)`)
      .join('\n');
  }

  // Icebreaker stats
  if (stats.icebreakerStats.top.length > 0) {
    text += `\n\n*💬 Top icebreakers:*\n`;
    text += stats.icebreakerStats.top
      .map((q) => `• _"${q.question}"_ _(+${q.net_score})_`)
      .join('\n');
  }

  if (stats.icebreakerStats.bottom.length > 0) {
    text += `\n\n*📉 Lowest rated icebreakers:*\n`;
    text += stats.icebreakerStats.bottom
      .map((q) => `• _"${q.question}"_ _(${q.net_score})_`)
      .join('\n');
  }

  return text;
}