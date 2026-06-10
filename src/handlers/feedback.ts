import { App } from '@slack/bolt';
import { db } from '../db/pool';
import { findWorkspaceBySlackId } from '../db/workspaces';

/**
 * Handles the two interactive buttons on the intro DM:
 *
 *   📅 Schedule a time — opens Google Calendar (link button, no handler needed)
 *   ✅ We met!         — records feedback and updates the message
 */
export function registerFeedbackHandlers(app: App): void {

  // The calendar button is a `url` type button — Slack opens the link
  // directly without sending an action to the server, so no handler needed.

  // "We met!" button — record feedback and update the message
  app.action('confirm_met', async ({ ack, body, action, client, logger }) => {
    await ack();

  // Acknowledge the calendar button click — required for mobile
  app.action('schedule_calendar', async ({ ack }) => {
    await ack();
  });

    try {
      const matchId = parseInt((action as { value: string }).value, 10);
      const slackUserId = body.user.id;
      const workspace = await findWorkspaceBySlackId(body.team?.id ?? '');
      if (!workspace) return;

      // Find the participant record for this user
      const { rows: participantRows } = await db.query<{ id: number }>(
        `SELECT id FROM participants WHERE workspace_id = $1 AND slack_user_id = $2`,
        [workspace.id, slackUserId]
      );
      if (participantRows.length === 0) return;

      const participantId = participantRows[0].id;

      // Upsert feedback — safe to click multiple times
      await db.query(
        `
        INSERT INTO feedback (match_id, participant_id, did_meet)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (match_id, participant_id)
        DO UPDATE SET did_meet = TRUE, created_at = NOW()
        `,
        [matchId, participantId]
      );

      // Check if ALL participants in this match have confirmed
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

      // Update the original message to reflect the confirmation
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
        // Replace the actions block with a confirmation message
        const existingBlocks = (messageBody.message?.blocks ?? []) as unknown[];

        // Remove the last actions block and context block, add confirmation
        const updatedBlocks = [
          ...existingBlocks.slice(0, -2), // keep intro + icebreaker blocks
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
}