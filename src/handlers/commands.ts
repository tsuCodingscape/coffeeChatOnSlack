import { App } from '@slack/bolt';
import { db } from '../db/pool';
import { findWorkspaceBySlackId, getProgramForWorkspace } from '../db/workspaces';
import {
  findParticipant,
  optOutParticipant,
  snoozeParticipant,
} from '../db/participants';

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
            '👋 You\'ve been removed from the coffee chat rotation — ' +
            'you won\'t be included in future matches.\n\n' +
            'You can stay in the channel or leave, it won\'t affect your opt-out status.\n\n' +
            'If you would like to be back on the rotation, use `/coffee rejoin`.'
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

          await respond(
            `${statusEmoji[participant.status]} *Status:* ${participant.status}\n` +
            `📅 *Next matching round:* ${nextRun}\n` +
            `🔄 *Cadence:* ${program?.cadence ?? 'unknown'}\n` +
            `📹 *Zoom link:* ${zoomStatus}`
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

        default: {
          await respond(
            '*Coffee Roulette commands:*\n' +
            '• `/coffee zoom` — add or update your Zoom link\n' +
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