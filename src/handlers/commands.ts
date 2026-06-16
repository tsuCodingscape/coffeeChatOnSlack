import { App } from '@slack/bolt';
import { findWorkspaceBySlackId, getProgramForWorkspace } from '../db/workspaces';
import {
  findParticipant,
  optOutParticipant,
  snoozeParticipant,
  saveTimezone,
} from '../db/participants';
import { db } from '../db/pool';
import { TIMEZONE_OPTIONS } from '../utils/timezone';

export function registerSlashCommands(app: App): void {

  app.command('/coffee', async ({ command, ack, respond, context, logger, client }) => {
    await ack();

    const subcommand = command.text.trim().toLowerCase().split(/\s+/)[0];
    const { team_id, user_id } = command;

    try {
      const workspace = await findWorkspaceBySlackId(team_id);
      if (!workspace) {
        await respond('⚠️ Coffee Roulette hasn\'t been set up in this workspace yet.');
        return;
      }

      const program = await getProgramForWorkspace(workspace.id);
      const participant = await findParticipant(workspace.id, user_id);

      switch (subcommand) {

        case 'snooze': {
          if (!participant || participant.status === 'opted_out') {
            await respond(`You're not currently in the rotation. Join <#${program?.channel_id}> to opt in.`);
            return;
          }
          if (participant.status === 'snoozed') {
            await respond('You\'re already snoozed for the next round. ✓');
            return;
          }
          const snoozedUntil = program?.next_run_at ?? addDays(new Date(), 7);
          await snoozeParticipant(workspace.id, user_id, snoozedUntil);
          await respond('😴 Got it — you\'ll sit out the next matching round. You\'ll be back in the rotation automatically after that.');
          break;
        }

        case 'optout': {
          if (!participant || participant.status === 'opted_out') {
            await respond('You\'re not currently in the rotation.');
            return;
          }
          await optOutParticipant(workspace.id, user_id);
          await respond(
            '👋 You\'ve been removed from the coffee chat rotation.\n\n' +
            `If you would like to be back on the rotation, join <#${program!.channel_id}> again.`
          );
          break;
        }

        case 'rejoin': {
          if (!participant) {
            await respond(`You're not registered. Join <#${program?.channel_id}> to opt in.`);
            return;
          }
          if (participant.status === 'active') {
            await respond('You\'re already in the rotation! ✅');
            return;
          }
          await db.query(
            `UPDATE participants SET status = 'active', snoozed_until = NULL, updated_at = NOW()
             WHERE workspace_id = $1 AND slack_user_id = $2`,
            [workspace.id, user_id]
          );
          await respond('☕ Welcome back! You\'re back in the coffee chat rotation.');
          break;
        }

        case 'status': {
          if (!participant || participant.status === 'opted_out') {
            await respond(`You're not in the rotation. Join <#${program?.channel_id ?? 'the coffee chat channel'}> to opt in.`);
            return;
          }

          const statusEmoji: Record<string, string> = {
            active: '✅',
            snoozed: '😴',
            opted_out: '🚫',
          };

          const nextRun = program?.next_run_at
            ? `<!date^${Math.floor(program.next_run_at.getTime() / 1000)}^{date_pretty}|${program.next_run_at.toDateString()}>`
            : 'not scheduled yet';

          const zoomStatus = participant.zoom_link
            ? `✅ Saved`
            : `❌ Not set — use \`/coffee zoom\` to add it`;

          const tzStatus = participant.timezone
            ? `✅ ${participant.timezone}`
            : `❌ Not set — use \`/coffee timezone\` to add it`;

          await respond(
            `${statusEmoji[participant.status]} *Status:* ${participant.status}\n` +
            `📅 *Next matching round:* ${nextRun}\n` +
            `🔄 *Cadence:* ${program?.cadence ?? 'unknown'}\n` +
            `📹 *Zoom link:* ${zoomStatus}\n` +
            `🌍 *Timezone:* ${tzStatus}`
          );
          break;
        }

        case 'zoom': {
          if (!participant || participant.status === 'opted_out') {
            await respond(`You're not in the rotation. Join <#${program?.channel_id ?? 'the coffee chat channel'}> to opt in first.`);
            return;
          }
          await client.views.open({
            trigger_id: command.trigger_id,
            view: {
              type: 'modal',
              callback_id: 'zoom_link_modal',
              title: { type: 'plain_text', text: 'Update Zoom link' },
              submit: { type: 'plain_text', text: 'Save' },
              close: { type: 'plain_text', text: 'Cancel' },
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: participant.zoom_link
                      ? `Your current Zoom link is:\n\`${participant.zoom_link}\`\n\nPaste a new one below to update it.`
                      : `Add your Zoom Personal Meeting Room link so it's shared with your coffee chat match.\n\n*How to find it:* Open Zoom → profile picture → *Personal Meeting Room* → copy the invite link.`,
                  },
                },
                {
                  type: 'input',
                  block_id: 'zoom_link_block',
                  label: { type: 'plain_text', text: 'Your Zoom personal meeting link' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'zoom_link_input',
                    initial_value: participant.zoom_link ?? '',
                    placeholder: {
                      type: 'plain_text',
                      text: 'https://zoom.us/j/123456789',
                    },
                  },
                },
              ],
            },
          });
          break;
        }

        // ── /coffee timezone — set your timezone for smarter scheduling ───────
        case 'timezone': {
          if (!participant || participant.status === 'opted_out') {
            await respond(`You're not in the rotation. Join <#${program?.channel_id ?? 'the coffee chat channel'}> to opt in first.`);
            return;
          }

          await client.views.open({
            trigger_id: command.trigger_id,
            view: {
              type: 'modal',
              callback_id: 'timezone_modal',
              title: { type: 'plain_text', text: 'Set your timezone' },
              submit: { type: 'plain_text', text: 'Save' },
              close: { type: 'plain_text', text: 'Cancel' },
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `Your timezone helps Coffee Roulette suggest meeting times that work for both you and your match.\n\n${participant.timezone ? `Current timezone: *${participant.timezone}*` : 'No timezone set yet.'}`,
                  },
                },
                {
                  type: 'input',
                  block_id: 'timezone_block',
                  label: { type: 'plain_text', text: 'Your timezone' },
                  element: {
                    type: 'static_select',
                    action_id: 'timezone_select',
                    placeholder: { type: 'plain_text', text: 'Select your timezone' },
                    initial_option: participant.timezone
                      ? TIMEZONE_OPTIONS.find((o) => o.value === participant.timezone)
                          ? {
                              text: { type: 'plain_text', text: TIMEZONE_OPTIONS.find((o) => o.value === participant.timezone)!.label },
                              value: participant.timezone,
                            }
                          : undefined
                      : undefined,
                    options: TIMEZONE_OPTIONS.map((tz) => ({
                      text: { type: 'plain_text', text: tz.label },
                      value: tz.value,
                    })),
                  },
                },
              ],
            },
          });
          break;
        }

        case 'history': {
          if (!participant) {
            await respond(`You're not registered. Join <#${program?.channel_id}> to opt in.`);
            return;
          }
        
          // Fetch last 5 matches for this participant
          const { rows } = await db.query<{
            matched_with: string;
            matched_on: Date;
            did_meet: boolean | null;
          }>(
            `
            SELECT
              CASE
                WHEN m.participant_a_id = p.id THEN pb.slack_user_id
                ELSE pa.slack_user_id
              END AS matched_with,
              mr.run_at AS matched_on,
              f.did_meet
            FROM matches m
            JOIN participants pa  ON pa.id = m.participant_a_id
            JOIN participants pb  ON pb.id = m.participant_b_id
            JOIN match_rounds mr  ON mr.id = m.match_round_id
            JOIN programs prog    ON prog.id = mr.program_id
            JOIN participants p   ON p.slack_user_id = $1 AND p.workspace_id = $2
              AND (m.participant_a_id = p.id OR m.participant_b_id = p.id)
            LEFT JOIN feedback f  ON f.match_id = m.id AND f.participant_id = p.id
            WHERE prog.workspace_id = $2
              AND mr.status = 'completed'
            ORDER BY mr.run_at DESC
            LIMIT 5
            `,
            [user_id, workspace.id]
          );
        
          if (rows.length === 0) {
            await respond('You haven\'t been matched yet — your first match is coming soon! ☕');
            return;
          }
        
          const historyLines = rows.map((row) => {
            const date = new Date(row.matched_on).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            const metStatus = row.did_meet === true
              ? '✅ Met'
              : row.did_meet === false
              ? '❌ Didn\'t meet'
              : '⏳ Pending';
        
            return `• <@${row.matched_with}> — ${date} — ${metStatus}`;
          });
        
          await respond(
            `*☕ Your coffee chat history:*\n\n${historyLines.join('\n')}`
          );
          break;
        }

        default: {
          await respond(
            '*Coffee Roulette commands:*\n' +
            '• `/coffee timezone` — set your timezone for smarter scheduling\n' +
            '• `/coffee zoom` — add or update your Zoom link\n' +
            '• `/coffee history` — see your past matches\n' +
            '• `/coffee snooze` — skip the next round\n' +
            '• `/coffee optout` — leave the rotation\n' +
            '• `/coffee rejoin` — come back to the rotation\n' +
            '• `/coffee status` — see your current status'
          );
        }
      }
    } catch (err) {
      logger.error('Error handling /coffee command:', err);
      await respond('Something went wrong. Please try again in a moment.');
    }
  });
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}