import { App } from '@slack/bolt';
import type { Block, KnownBlock, View } from '@slack/types';
import { findWorkspaceBySlackId, getProgramForWorkspace } from '../db/workspaces';
import {
  upsertParticipant,
  optOutParticipant,
  saveZoomLink,
  findParticipant,
} from '../db/participants';

export function registerOptInHandlers(app: App): void {

  // ── User joins a channel ───────────────────────────────────────────────────
  app.event('member_joined_channel', async ({ event, context, logger }) => {
    try {
      const { channel, user } = event;

      if (user === context.botUserId) return;

      const workspace = await findWorkspaceBySlackId(context.teamId!);
      if (!workspace) return;

      const program = await getProgramForWorkspace(workspace.id);
      if (!program) return;

      if (channel !== program.channel_id) return;

      await upsertParticipant(workspace.id, user);

      logger.info(`✅ Participant enrolled: ${user} in workspace ${workspace.slack_workspace_id}`);

      // Send welcome DM asking for their Zoom link
      await app.client.chat.postMessage({
        token: workspace.bot_token,
        channel: user,
        text: `👋 Welcome to Coffee Roulette! You're now in the rotation.`,
        blocks: buildWelcomeBlocks(program.cadence, program.channel_id),
      });

    } catch (err) {
      logger.error('Error handling member_joined_channel:', err);
    }
  });

  // ── User leaves a channel ─────────────────────────────────────────────────
  app.event('member_left_channel', async ({ event, context, logger }) => {
    try {
      const { channel, user } = event;

      if (user === context.botUserId) return;

      const workspace = await findWorkspaceBySlackId(context.teamId!);
      if (!workspace) return;

      const program = await getProgramForWorkspace(workspace.id);
      if (!program) return;

      if (channel !== program.channel_id) return;

      await optOutParticipant(workspace.id, user);

      logger.info(`👋 Participant opted out: ${user}`);

    } catch (err) {
      logger.error('Error handling member_left_channel:', err);
    }
  });

  // ── Handle Zoom link button click ─────────────────────────────────────────
  // Opens a modal asking the user to paste their Zoom link
  app.action('add_zoom_link', async ({ ack, body, client, context, logger }) => {
    await ack();

    try {
      await client.views.open({
        trigger_id: (body as { trigger_id: string }).trigger_id,
        view: buildZoomModal(),
      });
    } catch (err) {
      logger.error('Error opening Zoom modal:', err);
    }
  });

  // ── Handle Zoom modal submission ──────────────────────────────────────────
  app.view('zoom_link_modal', async ({ ack, body, view, context, logger }) => {
    await ack();

    try {
      const slackUserId = body.user.id;
      const zoomLink = view.state.values.zoom_link_block.zoom_link_input.value ?? '';

      // Basic validation — must look like a Zoom URL
      if (!zoomLink.includes('zoom.us')) {
        logger.warn(`Invalid Zoom link submitted by ${slackUserId}: ${zoomLink}`);
        return;
      }

      const workspace = await findWorkspaceBySlackId(context.teamId!);
      if (!workspace) return;

      await saveZoomLink(workspace.id, slackUserId, zoomLink);

      logger.info(`📹 Zoom link saved for ${slackUserId}`);

      // Confirm back to the user
      await app.client.chat.postMessage({
        token: workspace.bot_token,
        channel: slackUserId,
        text: `✅ Got it! Your Zoom link has been saved. It'll be included in your intro DM when you get matched. You can update it any time with \`/coffee zoom\`.`,
      });

    } catch (err) {
      logger.error('Error saving Zoom link:', err);
    }
  });
}

// ─── Welcome message ──────────────────────────────────────────────────────────

function buildWelcomeBlocks(cadence: string, channelId: string): (Block | KnownBlock)[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `☕ *Welcome to Coffee Roulette!*\n\nYou'll be randomly matched with a coworker for a casual chat every *${cadence}*. It's a great way to meet people outside your usual circle.`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Here's how it works:*`,
          `• On matching day you'll get a DM introducing you to your match`,
          `• Find a 20–30 min slot and have a casual chat`,
          `• That's it — no required topics, no agenda`,
        ].join('\n'),
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📹 *Add your Zoom link*\nSave your Zoom personal meeting room link so it's automatically included in your intro DM. Your match can use it to join without any extra setup.`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '📹 Add Zoom link', emoji: true },
        action_id: 'add_zoom_link',
        style: 'primary',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Handy commands:*`,
          `• \`/coffee zoom\` — update your Zoom link any time`,
          `• \`/coffee snooze\` — skip the next round`,
          `• \`/coffee optout\` — leave the rotation`,
          `• \`/coffee status\` — see when your next match is`,
        ].join('\n'),
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `You can leave <#${channelId}> at any time to opt out automatically.`,
        },
      ],
    },
  ];
}

// ─── Zoom link modal ──────────────────────────────────────────────────────────

function buildZoomModal(): View {
  return {
    type: 'modal',
    callback_id: 'zoom_link_modal',
    title: { type: 'plain_text', text: 'Add your Zoom link' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Your Zoom Personal Meeting Room link will be shared with your coffee chat match so they can join easily.\n\n*How to find it:*\n1. Open Zoom\n2. Click your profile picture → *Personal Meeting Room*\n3. Copy the invite link (looks like \`https://zoom.us/j/123456789\`)`,
        },
      },
      {
        type: 'input',
        block_id: 'zoom_link_block',
        label: { type: 'plain_text', text: 'Your Zoom personal meeting link' },
        element: {
          type: 'plain_text_input',
          action_id: 'zoom_link_input',
          placeholder: {
            type: 'plain_text',
            text: 'https://zoom.us/j/123456789',
          },
        },
      },
    ],
  };
}
