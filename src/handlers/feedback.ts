import { App } from '@slack/bolt';
import { db } from '../db/pool';
import { findWorkspaceBySlackId } from '../db/workspaces';

/**
 * Handles interactive buttons on both the intro DM and nudge DM:
 *
 *   ✅ We met!      — records feedback and updates the message
 *   ⏰ Not yet      — acknowledges and encourages without pressure
 *   📅 Schedule     — acknowledges the calendar button click (required for mobile)
 */
export function registerFeedbackHandlers(app: App): void {

  // ── We met! ────────────────────────────────────────────────────────────────
  app.action('confirm_met', async ({ ack, body, action, client, logger }) => {
    await ack();

    try {
      const matchId = parseInt((action as { value: string }).value, 10);
      const slackUserId = body.user.id;
      const workspace = await findWorkspaceBySlackId(body.team?.id ?? '');
      if (!workspace) return;

      const { rows: participantRows } = await db.query<{ id: number }>(
        `SELECT id FROM participants WHERE workspace_id = $1 AND slack_user_id = $2`,
        [workspace.id, slackUserId]
      );
      if (participantRows.length === 0) return;

      const participantId = participantRows[0].id;

      await db.query(
        `
        INSERT INTO feedback (match_id, participant_id, did_meet)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (match_id, participant_id)
        DO UPDATE SET did_meet = TRUE, created_at = NOW()
        `,
        [matchId, participantId]
      );

      // Check if ALL participants confirmed
      const { rows: matchRows } = await db.query<{
        participant_a_id: number;
        participant_b_id: number;
        participant_c_id: number | null;
      }>(
        `SELECT participant_a_id, participant_b_id, participant_c_id
         FROM matches WHERE id = $1`,
        [matchId]
      );

      if (matchRows.length === 0) return;

      const match = matchRows[0];
      const participantIds = [
        match.participant_a_id,
        match.participant_b_id,
        match.participant_c_id,
      ].filter(Boolean) as number[];

      const { rows: feedbackRows } = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM feedback
         WHERE match_id = $1 AND did_meet = TRUE`,
        [matchId]
      );
      const confirmedCount = parseInt(feedbackRows[0].count, 10);
      const allConfirmed = confirmedCount >= participantIds.length;

      // Update the message to reflect confirmation
      const messageBody = body as {
        message?: { ts?: string; blocks?: unknown[] };
        channel?: { id?: string };
        container?: { channel_id?: string; message_ts?: string };
      };

      const channelId =
        messageBody.channel?.id ??
        messageBody.container?.channel_id;
      const messageTs =
        messageBody.message?.ts ??
        messageBody.container?.message_ts;

      if (channelId && messageTs) {
        const existingBlocks = (messageBody.message?.blocks ?? []) as unknown[];
        const updatedBlocks = [
          ...existingBlocks.slice(0, -2),
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: allConfirmed
                ? `🎉 Both of you confirmed you met — that's what this is all about!`
                : `✅ <@${slackUserId}> confirmed they met! Waiting for the other person to confirm.`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'Use `/coffee snooze` to skip a future round, or `/coffee optout` to leave the rotation.',
              },
            ],
          },
        ];

        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: updatedBlocks as never[],
          text: allConfirmed
            ? '🎉 Both confirmed they met!'
            : `✅ <@${slackUserId}> confirmed they met!`,
        });
      }

      logger.info(`✅ Feedback recorded: match ${matchId}, participant ${participantId}, allConfirmed=${allConfirmed}`);

    } catch (err) {
      logger.error('Error handling confirm_met action:', err);
    }
  });

  // ── Not yet ────────────────────────────────────────────────────────────────
  app.action('nudge_not_yet', async ({ ack, body, client, logger }) => {
    await ack();

    try {
      const messageBody = body as {
        message?: { ts?: string; blocks?: unknown[] };
        channel?: { id?: string };
        container?: { channel_id?: string; message_ts?: string };
      };

      const channelId =
        messageBody.channel?.id ??
        messageBody.container?.channel_id;
      const messageTs =
        messageBody.message?.ts ??
        messageBody.container?.message_ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `⏰ No worries! Life gets busy. Hope you two get a chance to connect soon. ☕`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `⏰ No worries! Life gets busy. Hope you two get a chance to connect soon. ☕\n\nWhen you do meet, hit the button below to let us know!`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '✅ We met!', emoji: true },
                  style: 'primary',
                  value: (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value ?? '0',
                  action_id: 'confirm_met',
                },
              ],
            },
          ],
        });
      }

    } catch (err) {
      logger.error('Error handling nudge_not_yet action:', err);
    }
  });

  // ── Schedule calendar button — must be acked for mobile ───────────────────
  app.action('schedule_calendar', async ({ ack }) => {
    await ack();
  });
}