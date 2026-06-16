import { App } from '@slack/bolt';
import { db } from '../db/pool';
import { findWorkspaceBySlackId } from '../db/workspaces';
import { recordIcebreakerFeedback } from '../utils/icebreakers_weighted';

/**
 * Handles all interactive buttons:
 *
 *   ✅ We met!           — records meeting confirmation
 *   ⏰ Not yet           — acknowledges nudge response
 *   📅 Schedule          — acknowledges calendar button (mobile fix)
 *   👍 Great starter     — thumbs up on icebreaker
 *   👎 Not for me        — thumbs down on icebreaker
 */
export function registerFeedbackHandlers(app: App): void {

  // ── We met! ────────────────────────────────────────────────────────────────
  app.action('confirm_met', async ({ ack, body, action, client, logger }) => {
    await ack();

    setImmediate(async () => {
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

        logger.info(`✅ Feedback recorded: match ${matchId}, participant ${participantId}`);

      } catch (err) {
        logger.error('Error handling confirm_met action:', err);
      }
    });
  });

  // ── Not yet ────────────────────────────────────────────────────────────────
  app.action('nudge_not_yet', async ({ ack, body, client, logger }) => {
    await ack();

    setImmediate(async () => {
      try {
        const messageBody = body as {
          message?: { ts?: string; blocks?: unknown[] };
          channel?: { id?: string };
          container?: { channel_id?: string; message_ts?: string };
          actions?: Array<{ value?: string }>;
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
            text: `⏰ No worries! Hope you two get a chance to connect soon. ☕`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `⏰ No worries! Life gets busy. Hope you two get a chance to connect soon. ☕\n\nWhen you do meet, hit the button below!`,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '✅ We met!', emoji: true },
                    style: 'primary',
                    value: messageBody.actions?.[0]?.value ?? '0',
                    action_id: 'confirm_met',
                  },
                ],
              },
            ],
          });
        }
      } catch (err) {
        logger.error('Error handling nudge_not_yet:', err);
      }
    });
  });

  // ── Schedule calendar button ack (required for mobile) ────────────────────
  app.action('schedule_calendar', async ({ ack }) => {
    await ack();
  });

  // ── Icebreaker thumbs up ───────────────────────────────────────────────────
  app.action('icebreaker_up', async ({ ack, body, action, client, logger }) => {
    await ack();

    setImmediate(async () => {
      try {
        const value = JSON.parse((action as { value: string }).value) as {
          matchId: number;
          question: string;
        };

        const slackUserId = body.user.id;
        const workspace = await findWorkspaceBySlackId(body.team?.id ?? '');
        if (!workspace) return;

        const { rows } = await db.query<{ id: number }>(
          `SELECT id FROM participants WHERE workspace_id = $1 AND slack_user_id = $2`,
          [workspace.id, slackUserId]
        );
        if (rows.length === 0) return;

        await recordIcebreakerFeedback(
          value.question,
          rows[0].id,
          value.matchId,
          'up'
        );

        // Update the rating buttons to show selection
        const messageBody = body as {
          message?: { ts?: string; blocks?: unknown[] };
          channel?: { id?: string };
          container?: { channel_id?: string; message_ts?: string };
        };

        const channelId = messageBody.channel?.id ?? messageBody.container?.channel_id;
        const messageTs = messageBody.message?.ts ?? messageBody.container?.message_ts;

        if (channelId && messageTs) {
          const existingBlocks = (messageBody.message?.blocks ?? []) as unknown[];
          // Replace the icebreaker rating block with a confirmation
          const updatedBlocks = existingBlocks.map((block: unknown) => {
            const b = block as { type?: string; block_id?: string };
            if (b.block_id === 'icebreaker_rating') {
              return {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: '👍 Thanks for the feedback!' }],
              };
            }
            return block;
          });

          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks as never[],
            text: 'Thanks for rating the conversation starter!',
          });
        }

        logger.info(`👍 Icebreaker rated up: "${value.question}" by ${slackUserId}`);

      } catch (err) {
        logger.error('Error handling icebreaker_up:', err);
      }
    });
  });

  // ── Icebreaker thumbs down ─────────────────────────────────────────────────
  app.action('icebreaker_down', async ({ ack, body, action, client, logger }) => {
    await ack();

    setImmediate(async () => {
      try {
        const value = JSON.parse((action as { value: string }).value) as {
          matchId: number;
          question: string;
        };

        const slackUserId = body.user.id;
        const workspace = await findWorkspaceBySlackId(body.team?.id ?? '');
        if (!workspace) return;

        const { rows } = await db.query<{ id: number }>(
          `SELECT id FROM participants WHERE workspace_id = $1 AND slack_user_id = $2`,
          [workspace.id, slackUserId]
        );
        if (rows.length === 0) return;

        await recordIcebreakerFeedback(
          value.question,
          rows[0].id,
          value.matchId,
          'down'
        );

        const messageBody = body as {
          message?: { ts?: string; blocks?: unknown[] };
          channel?: { id?: string };
          container?: { channel_id?: string; message_ts?: string };
        };

        const channelId = messageBody.channel?.id ?? messageBody.container?.channel_id;
        const messageTs = messageBody.message?.ts ?? messageBody.container?.message_ts;

        if (channelId && messageTs) {
          const existingBlocks = (messageBody.message?.blocks ?? []) as unknown[];
          const updatedBlocks = existingBlocks.map((block: unknown) => {
            const b = block as { type?: string; block_id?: string };
            if (b.block_id === 'icebreaker_rating') {
              return {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: '👎 Thanks for the feedback — we\'ll use better ones next time!' }],
              };
            }
            return block;
          });

          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks as never[],
            text: 'Thanks for rating the conversation starter!',
          });
        }

        logger.info(`👎 Icebreaker rated down: "${value.question}" by ${slackUserId}`);

      } catch (err) {
        logger.error('Error handling icebreaker_down:', err);
      }
    });
  });
}